/**
 * continuous-random-v1 — непрерывный поток для swipe / wave.
 * Персонализация не критерий; лайки не обязательны.
 * Пагинированный discovery + session candidate pool (без лимита треков за сессию).
 */
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { Track } from '../../types/track.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import { noteContinuousDiag } from './continuousDiag.ts'
import { CONTINUOUS_LIMITS } from './continuousLimits.ts'
import {
  allDiscoveryLanesExhausted,
  beginContinuousDiscoveryOperation,
  ensureContinuousDiscoverySession,
  ensureDiscoveryLanes,
  getContinuousPoolSize,
  isContinuousDiscoveryOperationCurrent,
  isDiscoveryRateLimited,
  markLaneError,
  markLanePageResult,
  noteContinuousRecent,
  noteContinuousSeed,
  pickNextDiscoveryLane,
  pushCandidatesToPool,
  setDiscoveryQueryOrder,
  takeFromCandidatePool,
  withSourceConcurrency,
  type DiscoveryLane,
} from './continuousSession.ts'
import {
  buildExclusionSets,
  copyIdentity,
  isExcludedTrack,
  titleIdentity,
} from './identity.ts'
import {
  type RecommendationCatalogPort,
  type RecommendationDiscoveryPage,
  type RecommendationEmptyReason,
  type RecommendationRequest,
  type RecommendationResult,
} from './types.ts'

export const CONTINUOUS_RANDOM_STRATEGY = 'continuous-random-v1' as const

/** @deprecated используйте CONTINUOUS_LIMITS.recentWindow */
export const CONTINUOUS_RECENT_WINDOW = CONTINUOUS_LIMITS.recentWindow

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
  fetchFeed?: (sourceId: string, signal: AbortSignal) => Promise<Track[]>
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
  return shuffleInPlace(queries)
}

function excludeSetFromRequest(request: RecommendationRequest): Set<string> {
  const sets = buildExclusionSets([
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
  return new Set([...sets.ids, ...sets.copies, ...sets.titles])
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const status =
    (error as { status?: number }).status ??
    (error as { statusCode?: number }).statusCode
  if (status === 429) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /RATE_LIMIT|\b429\b|rate.?limit/i.test(message)
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function fetchLanePage(
  lane: DiscoveryLane,
  port: ContinuousDiscoveryPort,
  signal: AbortSignal,
): Promise<RecommendationDiscoveryPage> {
  const limit = CONTINUOUS_LIMITS.apiPageSize
  const pageGate = mergeAbortSignals(signal, CONTINUOUS_LIMITS.pageTimeoutMs)
  try {
    return await withSourceConcurrency(lane.sourceId, async () => {
      if (lane.kind === 'feed') {
        if (port.fetchFeedPage) {
          return raceWithAbort(
            port.fetchFeedPage(lane.sourceId, {
              cursor: lane.cursor,
              limit,
              signal: pageGate.signal,
            }),
            pageGate.signal,
          )
        }
        if (!port.fetchFeed || lane.cursor) {
          // Без пагинации feed — одна страница; повтор с cursor не имитируем.
          return { tracks: [], nextCursor: null }
        }
        const tracks = await raceWithAbort(
          port.fetchFeed(lane.sourceId, pageGate.signal),
          pageGate.signal,
        )
        return { tracks, nextCursor: null }
      }

      const query = lane.query ?? ''
      if (port.searchPage) {
        return raceWithAbort(
          port.searchPage(lane.sourceId, query, {
            cursor: lane.cursor,
            limit,
            signal: pageGate.signal,
          }),
          pageGate.signal,
        )
      }
      if (lane.cursor) {
        // Адаптер без searchPage — не крутим «фейковый» cursor.
        return { tracks: [], nextCursor: null }
      }
      const tracks = await raceWithAbort(
        port.search(lane.sourceId, query, pageGate.signal),
        pageGate.signal,
      )
      return { tracks, nextCursor: null }
    })
  } finally {
    pageGate.dispose()
  }
}

async function refillCandidatePool(input: {
  request: RecommendationRequest
  port: ContinuousDiscoveryPort
  signal: AbortSignal
  excluded: ReturnType<typeof buildExclusionSets>
}): Promise<{ searchFailed: boolean; pages: number; hadPlayableInPool: boolean }> {
  let searchFailed = false
  let pages = 0
  const sourceIds = input.port.sources.map((item) => item.id)
  const op = beginContinuousDiscoveryOperation()

  // Исчерпанные lanes прошлой попытки не должны блокировать Retry / новый fill.
  if (allDiscoveryLanesExhausted() && getContinuousPoolSize() === 0) {
    ensureContinuousDiscoverySession(input.request.mode, { resetLanes: true })
    setDiscoveryQueryOrder(buildDiscoveryQueries(input.request.current), {
      force: true,
    })
  } else {
    setDiscoveryQueryOrder(buildDiscoveryQueries(input.request.current))
  }
  if (!isContinuousDiscoveryOperationCurrent(op)) {
    return { searchFailed: false, pages: 0, hadPlayableInPool: false }
  }
  ensureDiscoveryLanes(sourceIds)

  // Резерв библиотеки один раз, если pool пуст.
  if (getContinuousPoolSize() === 0 && input.request.library.length > 0) {
    const libraryPool = [...input.request.library]
      .filter(
        (item) =>
          item.externalId &&
          !item.disliked &&
          !item.hidden &&
          !isDemoSourceId(item.sourceId),
      )
      .map(libraryToTrack)
    if (isContinuousDiscoveryOperationCurrent(op)) {
      pushCandidatesToPool(shuffleInPlace(libraryPool).slice(0, CONTINUOUS_LIMITS.apiPageSize))
    }
  }

  while (
    pages < CONTINUOUS_LIMITS.maxPagesPerFill &&
    getContinuousPoolSize() < CONTINUOUS_LIMITS.maxPoolSize / 2 &&
    !input.signal.aborted &&
    isContinuousDiscoveryOperationCurrent(op)
  ) {
    if (isDiscoveryRateLimited()) {
      break
    }
    const lane = pickNextDiscoveryLane()
    if (!lane) {
      break
    }
    noteContinuousDiag({
      mode: input.request.mode,
      phase: 'discovery-query',
      source: lane.sourceId,
      query: lane.kind === 'feed' ? 'feed' : lane.query ?? '',
      reason: lane.cursor ? `cursor:${lane.cursor}` : 'page-0',
    })
    try {
      const page = await fetchLanePage(lane, input.port, input.signal)
      if (!isContinuousDiscoveryOperationCurrent(op)) {
        return {
          searchFailed,
          pages,
          hadPlayableInPool: getContinuousPoolSize() > 0,
        }
      }
      pages += 1
      const filtered = page.tracks.filter(
        (track) => !isExcludedTrack(track, input.excluded),
      )
      const added = pushCandidatesToPool(filtered)
      // Cursor двигаем по факту страницы провайдера, не по filtered/accepted.
      markLanePageResult(lane, {
        providerTracks: page.tracks.length,
        acceptedTracks: added,
        nextCursor: page.nextCursor,
      })
      noteContinuousDiag({
        mode: input.request.mode,
        phase: 'candidates',
        source: lane.sourceId,
        found: page.tracks.length,
        bufferSize: getContinuousPoolSize(),
        reason:
          added > 0
            ? 'pool-grow'
            : page.tracks.length === 0
              ? 'provider-empty'
              : page.nextCursor
                ? 'page-all-excluded-advance'
                : 'pool-skip-dupes',
      })
      // Уже есть кандидаты — не гоняем лишние query в этом refill.
      if (getContinuousPoolSize() >= CONTINUOUS_LIMITS.batchPlayableTarget) {
        break
      }
      // Пока pool пуст — продолжаем страницы (не останавливаемся на excluded-only).
      if (
        pages >= CONTINUOUS_LIMITS.maxQueriesPerFill &&
        getContinuousPoolSize() > 0
      ) {
        break
      }
    } catch (error) {
      if (!isContinuousDiscoveryOperationCurrent(op)) {
        return {
          searchFailed,
          pages,
          hadPlayableInPool: getContinuousPoolSize() > 0,
        }
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        // page/operation timeout — сохраняем уже найденный pool.
        break
      }
      searchFailed = true
      markLaneError(lane, isRateLimitError(error))
      if (isRateLimitError(error)) {
        break
      }
    }
  }

  return {
    searchFailed,
    pages,
    hadPlayableInPool: getContinuousPoolSize() > 0,
  }
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

async function selectPlayableFromPool(
  port: ContinuousDiscoveryPort,
  signal: AbortSignal,
  mode: RecommendationRequest['mode'],
  extraExclude: ReadonlySet<string>,
  limit: number,
): Promise<Track[]> {
  const selected: Track[] = []
  let checks = 0
  let playable = 0
  let unknown = 0
  let unavailable = 0
  let rejected = 0

  while (
    selected.length < limit &&
    checks < CONTINUOUS_LIMITS.maxPlayableChecksPerFill &&
    !signal.aborted
  ) {
    const batch = takeFromCandidatePool(1, extraExclude)
    if (batch.length === 0) {
      break
    }
    const track = batch[0]!
    checks += 1
    const status = await classifyPlayability(track, port, signal)
    if (status === 'PLAYABLE') {
      playable += 1
      selected.push(track)
      continue
    }
    if (status === 'UNKNOWN') {
      unknown += 1
      let ok = false
      try {
        ok = await port.isPlayable(track, signal)
      } catch {
        ok = false
      }
      if (ok) {
        playable += 1
        selected.push(track)
        noteContinuousDiag({
          mode,
          phase: 'select',
          trackId: track.id,
          reason: 'unknown-resolved-playable',
        })
        continue
      }
      rejected += 1
      continue
    }
    if (
      status === 'ERROR' ||
      status === 'AUTH_REQUIRED' ||
      status === 'SUBSCRIPTION_REQUIRED'
    ) {
      rejected += 1
      noteContinuousDiag({
        mode,
        phase: 'reject',
        trackId: track.id,
        reason: status.toLowerCase(),
      })
      continue
    }
    unavailable += 1
    rejected += 1
  }

  noteContinuousDiag({
    mode,
    phase: 'select',
    found: selected.length,
    playable,
    unknown,
    unavailable,
    rejected,
  })
  return selected
}

/**
 * Пополнить pool и вернуть до `limit` playable треков одним discovery-проходом.
 * Не запускает полный discovery отдельно на каждый трек.
 */
export async function collectContinuousPlayableBatch(
  request: RecommendationRequest,
  limit: number,
): Promise<Track[]> {
  const parent = request.signal ?? new AbortController().signal
  if (parent.aborted || limit <= 0) {
    return []
  }

  ensureContinuousDiscoverySession(request.mode)
  const op = beginContinuousDiscoveryOperation()
  const port = request.port as ContinuousDiscoveryPort
  const timeoutMs = request.timeoutMs ?? CONTINUOUS_LIMITS.operationTimeoutMs
  const gate = mergeAbortSignals(parent, timeoutMs)
  const extraExclude = excludeSetFromRequest(request)
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

  try {
    const selected: Track[] = []
    // Сначала забираем уже готовый pool (быстрый UP).
    selected.push(
      ...(await selectPlayableFromPool(
        port,
        gate.signal,
        request.mode,
        extraExclude,
        limit,
      )),
    )

    while (
      selected.length < limit &&
      !gate.signal.aborted &&
      isContinuousDiscoveryOperationCurrent(op)
    ) {
      if (allDiscoveryLanesExhausted() && getContinuousPoolSize() === 0) {
        break
      }
      const before = getContinuousPoolSize()
      await refillCandidatePool({
        request,
        port,
        signal: gate.signal,
        excluded,
      })
      if (!isContinuousDiscoveryOperationCurrent(op)) {
        break
      }
      // Уже есть playable — не ждём timeout дополнительных страниц.
      const more = await selectPlayableFromPool(
        port,
        gate.signal,
        request.mode,
        new Set([
          ...extraExclude,
          ...selected.flatMap((track) => [
            track.id,
            copyIdentity(track),
            titleIdentity(track.artist, track.title),
          ]),
        ]),
        limit - selected.length,
      )
      selected.push(...more)
      if (more.length === 0 && getContinuousPoolSize() === before) {
        // Нет прогресса (exhausted / rate limit / timeout).
        break
      }
      // Достаточно для buffer — выходим, даже если gate ещё жив.
      if (selected.length >= limit) {
        break
      }
      if (gate.timedOut() && selected.length > 0) {
        break
      }
    }

    if (!isContinuousDiscoveryOperationCurrent(op)) {
      return []
    }
    for (const track of selected) {
      noteContinuousRecent(track)
    }
    if (selected[0]) {
      noteContinuousSeed(selected[0])
    }
    return selected
  } finally {
    gate.dispose()
  }
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

  ensureContinuousDiscoverySession(request.mode)
  noteContinuousDiag({
    mode: request.mode,
    phase: 'discovery-start',
    source: port.sources.map((item) => item.id).join(',') || 'library-only',
  })

  try {
    if (isDiscoveryRateLimited()) {
      return miss(
        request,
        'error',
        'Источник временно ограничил запросы. Можно повторить чуть позже.',
      )
    }

    const batch = await collectContinuousPlayableBatch(request, 1)
    if (batch[0]) {
      return {
        ok: true,
        track: batch[0],
        reason: 'continuous-random',
        mode: request.mode,
      }
    }

    if (parent.aborted) {
      return miss(request, 'aborted', 'Подбор отменён.')
    }
    if (allDiscoveryLanesExhausted()) {
      return miss(
        request,
        'no-candidates',
        'Подключённые источники не дали новых воспроизводимых композиций. Можно повторить подбор.',
      )
    }
    return miss(
      request,
      'no-candidates',
      'Пока нет подходящих композиций. Можно повторить подбор.',
    )
  } catch {
    if (parent.aborted) {
      return miss(request, 'aborted', 'Подбор отменён.')
    }
    return miss(request, 'error', 'Ошибка подбора. Можно повторить.')
  }
}
