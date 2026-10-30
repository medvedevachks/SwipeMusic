/**
 * continuous-random-v1 — непрерывный поток для swipe / wave.
 * Персонализация не критерий выбора; лайки не обязательны для холодного старта.
 */
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { Track } from '../../types/track.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import { noteContinuousDiag } from './continuousDiag.ts'
import {
  buildExclusionSets,
  copyIdentity,
  isExcludedTrack,
  titleIdentity,
} from './identity.ts'
import {
  type RecommendationCatalogPort,
  type RecommendationEmptyReason,
  type RecommendationRequest,
  type RecommendationResult,
  RECOMMENDATION_LIMITS,
} from './types.ts'

export const CONTINUOUS_RANDOM_STRATEGY = 'continuous-random-v1' as const

/** Окно недавних композиций, которые не предлагаем снова. */
export const CONTINUOUS_RECENT_WINDOW = 40

/**
 * Разнообразные discovery-запросы (не вкус пользователя).
 * Для источников без random-feed — bounded search.
 */
export const CONTINUOUS_DISCOVERY_QUERIES = [
  'хиты',
  'популярное',
  'новинки',
  'инди',
  'рок',
  'поп',
  'электроника',
  'джаз',
  'hip-hop',
  'dance',
  'acoustic',
  'live',
  'ambient',
  'chill',
  'playlist',
  'top',
  'radio',
  'mix',
] as const

export type ContinuousAvailabilityStatus =
  | 'PLAYABLE'
  | 'UNKNOWN'
  | 'UNAVAILABLE'
  | 'AUTH_REQUIRED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'ERROR'

export type ContinuousDiscoveryPort = RecommendationCatalogPort & {
  /** Опциональный browse/library feed без поискового запроса. */
  fetchFeed?: (sourceId: string, signal: AbortSignal) => Promise<Track[]>
  /**
   * Расширенная availability. Если нет — используется isPlayable.
   * UNKNOWN ≠ UNAVAILABLE: допускается дополнительная проверка через isPlayable.
   */
  probeAvailability?: (
    track: Track,
    signal: AbortSignal,
  ) => Promise<ContinuousAvailabilityStatus>
}

function miss(
  request: RecommendationRequest,
  emptyReason: RecommendationEmptyReason,
  message: string,
): RecommendationResult {
  return {
    ok: false,
    emptyReason,
    mode: request.mode,
    message,
  }
}

function mergeAbortSignals(
  parent: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal
  dispose: () => void
  timedOut: () => boolean
} {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onParent = () => controller.abort()
  if (parent.aborted) {
    controller.abort()
  } else {
    parent.addEventListener('abort', onParent)
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParent)
    },
  }
}

function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

function libraryToTrack(item: ContinuationLibraryTrack): Track {
  return {
    id: item.id,
    sourceId: item.sourceId,
    externalId: item.externalId,
    title: item.title,
    artist: item.artist,
  }
}

function buildDiscoveryQueries(current: Track | null): string[] {
  const queries: string[] = [...CONTINUOUS_DISCOVERY_QUERIES]
  if (current?.artist?.trim()) {
    queries.push(current.artist.trim())
  }
  if (current?.title?.trim()) {
    queries.push(current.title.trim())
  }
  return shuffleInPlace(queries).slice(0, 10)
}

async function collectCandidates(input: {
  request: RecommendationRequest
  port: ContinuousDiscoveryPort
  signal: AbortSignal
  excluded: ReturnType<typeof buildExclusionSets>
}): Promise<{
  candidates: Track[]
  searchFailed: boolean
  emptySearchPaths: number
}> {
  const candidates: Track[] = []
  const seen = new Set<string>()
  let searchFailed = false
  let emptySearchPaths = 0

  const push = (track: Track) => {
    if (isExcludedTrack(track, input.excluded)) {
      return
    }
    const key = copyIdentity(track)
    const title = titleIdentity(track.artist, track.title)
    if (seen.has(key) || seen.has(title) || seen.has(track.id)) {
      return
    }
    seen.add(key)
    seen.add(title)
    seen.add(track.id)
    candidates.push(track)
  }

  // 1) Browse/library feeds (если порт умеет).
  if (input.port.fetchFeed) {
    for (const source of input.port.sources) {
      if (input.signal.aborted) {
        break
      }
      try {
        const feed = await input.port.fetchFeed(source.id, input.signal)
        noteContinuousDiag({
          mode: input.request.mode,
          phase: 'discovery-query',
          source: source.id,
          query: 'feed',
          found: feed.length,
        })
        if (feed.length === 0) {
          emptySearchPaths += 1
        }
        for (const track of feed.slice(0, RECOMMENDATION_LIMITS.maxPerSearch * 2)) {
          push(track)
        }
      } catch {
        searchFailed = true
      }
    }
  }

  // 2) Разнообразный search (не только liked artists).
  if (input.port.sources.length > 0) {
    const queries = buildDiscoveryQueries(input.request.current)
    for (const query of queries) {
      if (input.signal.aborted) {
        break
      }
      if (candidates.length >= RECOMMENDATION_LIMITS.maxCatalogCandidates) {
        break
      }
      for (const source of input.port.sources) {
        if (input.signal.aborted) {
          break
        }
        noteContinuousDiag({
          mode: input.request.mode,
          phase: 'discovery-query',
          source: source.id,
          query,
        })
        let found: Track[] = []
        try {
          found = await input.port.search(source.id, query, input.signal)
        } catch {
          searchFailed = true
          continue
        }
        if (found.length === 0) {
          emptySearchPaths += 1
        }
        for (const track of found.slice(0, RECOMMENDATION_LIMITS.maxPerSearch)) {
          push(track)
        }
      }
    }
  }

  // 3) Резерв: известная библиотека (не только лайки).
  const libraryPool = [...input.request.library]
    .filter(
      (item) =>
        item.externalId &&
        !item.disliked &&
        !item.hidden &&
        !isDemoSourceId(item.sourceId),
    )
    .sort((left, right) => {
      // Лёгкий shuffle-bias: liked чуть раньше, но не обязательны.
      const likeDelta = Number(right.liked) - Number(left.liked)
      if (likeDelta !== 0) {
        return likeDelta
      }
      return (right.lastPlayed ?? '').localeCompare(left.lastPlayed ?? '')
    })
  for (const item of shuffleInPlace(libraryPool).slice(0, RECOMMENDATION_LIMITS.maxLibraryProbes * 2)) {
    push(libraryToTrack(item))
  }

  return { candidates, searchFailed, emptySearchPaths }
}

async function classifyPlayability(
  track: Track,
  port: ContinuousDiscoveryPort,
  signal: AbortSignal,
): Promise<ContinuousAvailabilityStatus> {
  if (port.probeAvailability) {
    try {
      return await port.probeAvailability(track, signal)
    } catch {
      return 'ERROR'
    }
  }
  try {
    const playable = await port.isPlayable(track, signal)
    return playable ? 'PLAYABLE' : 'UNAVAILABLE'
  } catch {
    return 'ERROR'
  }
}

async function firstPlayableRandom(
  candidates: readonly Track[],
  port: ContinuousDiscoveryPort,
  signal: AbortSignal,
  mode: RecommendationRequest['mode'],
): Promise<{ track: Track } | null> {
  let playable = 0
  let unknown = 0
  let unavailable = 0
  let rejected = 0

  for (const track of candidates) {
    if (signal.aborted) {
      return null
    }
    const status = await classifyPlayability(track, port, signal)
    if (status === 'PLAYABLE') {
      playable += 1
      noteContinuousDiag({
        mode,
        phase: 'select',
        trackId: track.id,
        playable,
        unknown,
        unavailable,
        rejected,
      })
      return { track }
    }
    if (status === 'UNKNOWN') {
      unknown += 1
      // UNKNOWN: повторная проверка через isPlayable (resolver/candidates внутри порта).
      let ok = false
      try {
        ok = await port.isPlayable(track, signal)
      } catch {
        ok = false
      }
      if (ok) {
        playable += 1
        noteContinuousDiag({
          mode,
          phase: 'select',
          trackId: track.id,
          reason: 'unknown-resolved-playable',
          playable,
          unknown,
          unavailable,
          rejected,
        })
        return { track }
      }
      rejected += 1
      noteContinuousDiag({
        mode,
        phase: 'reject',
        trackId: track.id,
        reason: 'unknown-unresolved',
      })
      continue
    }
    if (status === 'ERROR' || status === 'AUTH_REQUIRED' || status === 'SUBSCRIPTION_REQUIRED') {
      rejected += 1
      noteContinuousDiag({
        mode,
        phase: 'reject',
        trackId: track.id,
        reason: status.toLowerCase(),
      })
      // AUTH/SUBSCRIPTION на одном треке не останавливает весь поток.
      continue
    }
    unavailable += 1
    rejected += 1
    noteContinuousDiag({
      mode,
      phase: 'reject',
      trackId: track.id,
      reason: 'unavailable',
    })
  }

  noteContinuousDiag({
    mode,
    phase: 'candidates',
    found: candidates.length,
    playable,
    unknown,
    unavailable,
    rejected,
  })
  return null
}

/**
 * Выбор следующего трека continuous-random-v1.
 */
export async function pickContinuousRandom(
  request: RecommendationRequest,
): Promise<RecommendationResult> {
  const parent = request.signal ?? new AbortController().signal
  if (parent.aborted) {
    return miss(request, 'aborted', 'Подбор отменён.')
  }

  const port = request.port as ContinuousDiscoveryPort
  if (port.sources.length === 0 && request.library.length === 0) {
    return miss(
      request,
      'no-sources',
      'Нет доступных источников музыки. Подключите источник и нажмите «Повторить».',
    )
  }

  noteContinuousDiag({
    mode: request.mode,
    phase: 'discovery-start',
    source: port.sources.map((item) => item.id).join(',') || 'library-only',
  })

  const timeoutMs = request.timeoutMs ?? RECOMMENDATION_LIMITS.searchTimeoutMs
  const gate = mergeAbortSignals(parent, timeoutMs)

  try {
    const excluded = buildExclusionSets([
      ...request.excluded,
      ...(request.current
        ? [
            {
              id: request.current.id,
              title: request.current.title,
              artist: request.current.artist,
              sourceId: request.current.sourceId,
              externalId: request.current.externalId,
            },
          ]
        : []),
    ])

    const collected = await collectCandidates({
      request,
      port,
      signal: gate.signal,
      excluded,
    })

    if (gate.signal.aborted && gate.timedOut()) {
      return miss(
        request,
        'timeout',
        'Подбор превысил время ожидания. Можно повторить.',
      )
    }
    if (gate.signal.aborted || parent.aborted) {
      return miss(request, 'aborted', 'Подбор отменён.')
    }

    if (collected.candidates.length === 0) {
      if (collected.searchFailed) {
        return miss(
          request,
          'error',
          'Не удалось опросить источники. Можно повторить подбор.',
        )
      }
      return miss(
        request,
        'no-candidates',
        'Пока нет подходящих композиций. Можно повторить подбор.',
      )
    }

    const shuffled = shuffleInPlace([...collected.candidates])
    noteContinuousDiag({
      mode: request.mode,
      phase: 'candidates',
      found: shuffled.length,
    })

    const picked = await firstPlayableRandom(shuffled, port, gate.signal, request.mode)
    if (gate.signal.aborted && gate.timedOut()) {
      return miss(
        request,
        'timeout',
        'Проверка доступности превысила время. Можно повторить.',
      )
    }
    if (gate.signal.aborted || parent.aborted) {
      return miss(request, 'aborted', 'Подбор отменён.')
    }
    if (!picked) {
      return miss(
        request,
        'all-unavailable',
        'Кандидаты найдены, но ни один сейчас недоступен. Можно повторить.',
      )
    }

    return {
      ok: true,
      track: picked.track,
      reason: 'continuous-random',
      mode: request.mode,
    }
  } catch {
    if (parent.aborted || gate.signal.aborted) {
      return miss(
        request,
        gate.timedOut() ? 'timeout' : 'aborted',
        gate.timedOut()
          ? 'Подбор превысил время ожидания. Можно повторить.'
          : 'Подбор отменён.',
      )
    }
    return miss(request, 'error', 'Ошибка подбора. Можно повторить.')
  } finally {
    gate.dispose()
  }
}

/** Несколько playable кандидатов для prefetch-буфера (без повторного полного discovery при возможности). */
export async function collectContinuousPlayableBatch(
  request: RecommendationRequest,
  limit: number,
): Promise<Track[]> {
  const result: Track[] = []
  const excluded = [...request.excluded]
  for (let i = 0; i < limit; i += 1) {
    const pick = await pickContinuousRandom({
      ...request,
      excluded,
      current: request.current ?? result[result.length - 1] ?? null,
    })
    if (!pick.ok) {
      break
    }
    result.push(pick.track)
    excluded.push({
      id: pick.track.id,
      title: pick.track.title,
      artist: pick.track.artist,
      sourceId: pick.track.sourceId,
      externalId: pick.track.externalId,
    })
  }
  return result
}
