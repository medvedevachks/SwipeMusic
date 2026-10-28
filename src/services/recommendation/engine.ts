import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { Track } from '../../types/track.ts'
import {
  normalizeArtistName,
  rankSearchContinuations,
  type ContinuationLibraryTrack,
  type ContinuationReason,
} from '../continuation/libraryContinuation.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import { buildExclusionSets, isExcludedTrack, titleIdentity } from './identity.ts'
import {
  RECOMMENDATION_LIMITS,
  type RecommendationCatalogPort,
  type RecommendationEmptyReason,
  type RecommendationReason,
  type RecommendationRequest,
  type RecommendationResult,
} from './types.ts'

type RankedCandidate = {
  track: Track
  reason: RecommendationReason
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

function mapLibraryReason(reason: ContinuationReason): RecommendationReason {
  return reason
}

function libraryTrackToTrack(item: ContinuationLibraryTrack): Track {
  return {
    id: item.id,
    sourceId: item.sourceId,
    externalId: item.externalId,
    title: item.title,
    artist: item.artist,
  }
}

function mergeAbortSignals(parent: AbortSignal, timeoutMs: number): {
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

type ArtistSeedOrigin = 'liked' | 'taste' | 'current'

type ArtistSeed = {
  name: string
  origin: ArtistSeedOrigin
}

/**
 * Seeds for catalog search. Preference order (not current-first):
 * 1) liked library artists
 * 2) positive taste artists
 * 3) current track artist as a weak extra signal
 * Current must not monopolize the next pick when taste/liked alternatives exist.
 */
function seedArtists(input: {
  current: Track | null
  library: readonly ContinuationLibraryTrack[]
  taste: UserTasteProfile | null
}): ArtistSeed[] {
  const artists: ArtistSeed[] = []
  const seen = new Set<string>()
  const push = (artist: string, origin: ArtistSeedOrigin) => {
    const trimmed = artist.trim()
    const key = normalizeArtistName(trimmed)
    if (!trimmed || seen.has(key)) {
      return
    }
    seen.add(key)
    artists.push({ name: trimmed, origin })
  }

  const liked = input.library
    .filter((item) => item.liked && !item.disliked && !item.hidden && item.externalId)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return (right.lastPlayed ?? '').localeCompare(left.lastPlayed ?? '')
    })
  for (const item of liked) {
    push(item.artist, 'liked')
    if (artists.length >= RECOMMENDATION_LIMITS.maxArtists) {
      return artists
    }
  }

  const tasteTracks = [...(input.taste?.tracks ?? [])]
    .filter((track) => track.score > 0 && Boolean(track.label?.artist))
    .sort((left, right) => right.score - left.score)
  for (const track of tasteTracks) {
    const artist = track.label?.artist
    if (!artist) {
      continue
    }
    push(artist, 'taste')
    if (artists.length >= RECOMMENDATION_LIMITS.maxArtists) {
      return artists
    }
  }

  if (input.current?.artist) {
    push(input.current.artist, 'current')
  }

  return artists.slice(0, RECOMMENDATION_LIMITS.maxArtists)
}

function preferredArtistKeys(seeds: readonly ArtistSeed[]): Set<string> {
  const keys = new Set<string>()
  for (const seed of seeds) {
    if (seed.origin === 'liked' || seed.origin === 'taste') {
      keys.add(normalizeArtistName(seed.name))
    }
  }
  return keys
}

function catalogReasonForOrigin(origin: ArtistSeedOrigin): RecommendationReason {
  if (origin === 'taste' || origin === 'liked') {
    return 'taste-positive'
  }
  return 'catalog-artist-search'
}

function rankingPreferredArtists(
  seeds: readonly ArtistSeed[],
  current: Track | null,
): Set<string> {
  const keys = preferredArtistKeys(seeds)
  const currentKey = current ? normalizeArtistName(current.artist) : ''
  const hasOtherPreferred = [...keys].some((key) => key !== currentKey)
  // Не бустить текущего исполнителя, если есть другие вкусовые/лайкнутые.
  if (currentKey && hasOtherPreferred) {
    keys.delete(currentKey)
  }
  return keys
}

function candidateRankScore(
  item: RankedCandidate,
  current: Track | null,
  preferredArtists: ReadonlySet<string>,
  heardArtists: ReadonlySet<string>,
): number {
  const artistKey = normalizeArtistName(item.track.artist)
  const currentKey = current ? normalizeArtistName(current.artist) : ''
  let score = 0
  switch (item.reason) {
    case 'library-like':
      score += 100
      break
    case 'taste-positive':
      score += 90
      break
    case 'same-artist':
      score += 25
      break
    case 'known-rest':
      score += 15
      break
    case 'catalog-artist-search':
      score += 20
      break
    default:
      break
  }
  if (preferredArtists.has(artistKey)) {
    score += 50
  }
  // Diversity: do not walk the starter artist's catalog when taste/liked options exist.
  if (currentKey && artistKey === currentKey) {
    score -= preferredArtists.size > 0 ? 60 : 10
  }
  if (heardArtists.has(artistKey) && preferredArtists.size > 0) {
    score -= 35
  }
  return score
}

function prioritizeCandidates(
  items: readonly RankedCandidate[],
  current: Track | null,
  preferredArtists: ReadonlySet<string>,
  heardArtists: ReadonlySet<string>,
): RankedCandidate[] {
  return [...items].sort(
    (left, right) =>
      candidateRankScore(right, current, preferredArtists, heardArtists) -
      candidateRankScore(left, current, preferredArtists, heardArtists),
  )
}

async function collectCatalogCandidates(input: {
  artists: readonly ArtistSeed[]
  port: RecommendationCatalogPort
  signal: AbortSignal
  excluded: ReturnType<typeof buildExclusionSets>
}): Promise<{ candidates: RankedCandidate[]; searchFailed: boolean }> {
  const candidates: RankedCandidate[] = []
  const seen = new Set<string>()
  let searchFailed = false

  for (const artist of input.artists) {
    if (input.signal.aborted) {
      break
    }
    for (const source of input.port.sources) {
      if (input.signal.aborted) {
        break
      }
      let found: Track[] = []
      try {
        found = await input.port.search(source.id, artist.name, input.signal)
      } catch {
        searchFailed = true
        continue
      }
      for (const track of found.slice(0, RECOMMENDATION_LIMITS.maxPerSearch)) {
        if (isExcludedTrack(track, input.excluded)) {
          continue
        }
        const key = `${track.sourceId}:${track.externalId}`
        if (seen.has(key) || seen.has(titleIdentity(track.artist, track.title))) {
          continue
        }
        seen.add(key)
        seen.add(titleIdentity(track.artist, track.title))
        candidates.push({
          track,
          reason: catalogReasonForOrigin(artist.origin),
        })
        if (candidates.length >= RECOMMENDATION_LIMITS.maxCatalogCandidates) {
          return { candidates, searchFailed }
        }
      }
    }
  }

  return { candidates, searchFailed }
}

function collectLibraryCandidates(input: {
  current: Track
  library: readonly ContinuationLibraryTrack[]
  excludedIds: readonly string[]
  excludedPlayed: readonly { title: string; artist: string }[]
}): RankedCandidate[] {
  if (input.library.length === 0) {
    return []
  }
  const ranked = rankSearchContinuations({
    seed: {
      id: input.current.id,
      sourceId: input.current.sourceId,
      title: input.current.title,
      artist: input.current.artist,
      artistId: null,
    },
    library: input.library,
    queueIds: input.excludedIds,
    played: input.excludedPlayed,
  }).slice(0, RECOMMENDATION_LIMITS.maxLibraryProbes)

  return ranked.map((pick) => ({
    track: libraryTrackToTrack(pick.track),
    reason: mapLibraryReason(pick.reason),
  }))
}

/**
 * Cold start без current: взять лайкнутый трек библиотеки как первую рекомендацию,
 * если он воспроизводим. Не использует поисковую выдачу UI.
 */
function collectColdStartLibraryCandidates(
  library: readonly ContinuationLibraryTrack[],
  excluded: ReturnType<typeof buildExclusionSets>,
): RankedCandidate[] {
  const liked = library
    .filter(
      (item) =>
        item.liked &&
        !item.disliked &&
        !item.hidden &&
        item.externalId &&
        !isDemoSourceId(item.sourceId),
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return (right.lastPlayed ?? '').localeCompare(left.lastPlayed ?? '')
    })

  const out: RankedCandidate[] = []
  for (const item of liked) {
    const track = libraryTrackToTrack(item)
    if (isExcludedTrack(track, excluded)) {
      continue
    }
    out.push({ track, reason: 'library-like' })
    if (out.length >= RECOMMENDATION_LIMITS.maxLibraryProbes) {
      break
    }
  }
  return out
}

async function firstPlayable(
  candidates: readonly RankedCandidate[],
  port: RecommendationCatalogPort,
  signal: AbortSignal,
): Promise<RankedCandidate | null> {
  for (const candidate of candidates) {
    if (signal.aborted) {
      return null
    }
    if (!candidate.track.externalId || isDemoSourceId(candidate.track.sourceId)) {
      continue
    }
    let playable = false
    try {
      playable = await port.isPlayable(candidate.track, signal)
    } catch {
      playable = false
    }
    if (playable) {
      return candidate
    }
  }
  return null
}

/**
 * Единый Recommendation Engine.
 * Search UI results сюда не передаются и не читаются.
 * mode (swipe|wave) пока не меняет правила — только маркирует вызов.
 */
export async function recommendNext(
  request: RecommendationRequest,
): Promise<RecommendationResult> {
  const parent = request.signal ?? new AbortController().signal
  if (parent.aborted) {
    return miss(request, 'aborted', 'Подбор отменён.')
  }

  if (request.port.sources.length === 0 && request.library.length === 0) {
    return miss(request, 'no-sources', 'Нет доступных источников и библиотеки для рекомендаций.')
  }

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

    const artists = seedArtists({
      current: request.current,
      library: request.library,
      taste: request.taste,
    })
    const preferredArtists = rankingPreferredArtists(artists, request.current)
    const heardArtists = new Set<string>()
    for (const item of request.excluded) {
      heardArtists.add(normalizeArtistName(item.artist))
    }
    if (request.current?.artist) {
      heardArtists.add(normalizeArtistName(request.current.artist))
    }

    if (!request.current && artists.length === 0 && request.library.every((item) => !item.liked)) {
      return miss(
        request,
        'no-seed',
        'Нет стартовой композиции и избранного для автоматической рекомендации.',
      )
    }

    const ordered: RankedCandidate[] = []
    const seenKeys = new Set<string>()
    const pushUnique = (list: readonly RankedCandidate[]) => {
      for (const item of list) {
        if (isExcludedTrack(item.track, excluded)) {
          continue
        }
        const key = `${item.track.sourceId}:${item.track.externalId}`
        const title = titleIdentity(item.track.artist, item.track.title)
        if (seenKeys.has(key) || seenKeys.has(title)) {
          continue
        }
        seenKeys.add(key)
        seenKeys.add(title)
        ordered.push(item)
      }
    }

    if (request.current) {
      pushUnique(
        collectLibraryCandidates({
          current: request.current,
          library: request.library,
          excludedIds: [
            request.current.id,
            ...request.excluded.map((item) => item.id).filter((id): id is string => Boolean(id)),
          ],
          excludedPlayed: [
            { title: request.current.title, artist: request.current.artist },
            ...request.excluded.map((item) => ({ title: item.title, artist: item.artist })),
          ],
        }),
      )
    } else {
      pushUnique(collectColdStartLibraryCandidates(request.library, excluded))
    }

    if (request.port.sources.length > 0 && artists.length > 0) {
      const catalog = await collectCatalogCandidates({
        artists,
        port: request.port,
        signal: gate.signal,
        excluded,
      })
      if (gate.signal.aborted && gate.timedOut()) {
        return miss(request, 'timeout', 'Поиск рекомендаций превысил время ожидания.')
      }
      if (gate.signal.aborted || parent.aborted) {
        return miss(request, 'aborted', 'Подбор отменён.')
      }
      pushUnique(catalog.candidates)
      if (
        ordered.length === 0 &&
        catalog.searchFailed &&
        catalog.candidates.length === 0
      ) {
        return miss(request, 'error', 'Не удалось опросить источники рекомендаций.')
      }
    }

    if (ordered.length === 0) {
      return miss(request, 'no-candidates', 'Подходящих рекомендаций не найдено.')
    }

    const ranked = prioritizeCandidates(
      ordered,
      request.current,
      preferredArtists,
      heardArtists,
    )
    const picked = await firstPlayable(ranked, request.port, gate.signal)
    if (gate.signal.aborted && gate.timedOut()) {
      return miss(request, 'timeout', 'Проверка доступности превысила время ожидания.')
    }
    if (gate.signal.aborted || parent.aborted) {
      return miss(request, 'aborted', 'Подбор отменён.')
    }
    if (!picked) {
      return miss(
        request,
        'all-unavailable',
        'Кандидаты найдены, но ни один не удалось воспроизвести.',
      )
    }

    return {
      ok: true,
      track: picked.track,
      reason: picked.reason,
      mode: request.mode,
    }
  } catch {
    if (parent.aborted || gate.signal.aborted) {
      return miss(
        request,
        gate.timedOut() ? 'timeout' : 'aborted',
        gate.timedOut()
          ? 'Поиск рекомендаций превысил время ожидания.'
          : 'Подбор отменён.',
      )
    }
    return miss(request, 'error', 'Ошибка подбора рекомендации.')
  } finally {
    gate.dispose()
  }
}

/** Сравнивает стратегию режимов: пока правила идентичны. */
export function recommendationStrategyFingerprint(mode: RecommendationRequest['mode']): string {
  return `unified-v1:${mode}:same-rules`
}

export function sameRecommendationStrategy(
  left: RecommendationRequest['mode'],
  right: RecommendationRequest['mode'],
): boolean {
  return (
    recommendationStrategyFingerprint(left).replace(`:${left}:`, ':x:') ===
    recommendationStrategyFingerprint(right).replace(`:${right}:`, ':x:')
  )
}

