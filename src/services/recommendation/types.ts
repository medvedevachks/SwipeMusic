import type { Track } from '../../types/track.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'

/**
 * Режим вызова. В этой итерации стратегия подбора одинаковая;
 * веса новизны / близости / разнообразия появятся позже.
 */
export type RecommendationMode = 'swipe' | 'wave'

/**
 * continuous-random — обычные Swipe / Wave.
 * legacy — Search continuation (taste/artist + жёсткие исключения выдачи).
 */
export type RecommendationStrategy = 'continuous-random' | 'legacy'

export type RecommendationReason =
  | 'catalog-artist-search'
  | 'library-like'
  | 'taste-positive'
  | 'same-artist'
  | 'known-rest'
  | 'continuous-random'

export type RecommendationEmptyReason =
  | 'no-sources'
  | 'no-seed'
  | 'no-candidates'
  | 'all-unavailable'
  | 'aborted'
  | 'timeout'
  | 'error'

/** Одна страница discovery (cursor сохраняется в continuous session). */
export type RecommendationDiscoveryPage = {
  tracks: Track[]
  nextCursor: string | null
}

/** Порт каталога: search + опциональный feed / paginated discovery. */
export type RecommendationCatalogPort = {
  sources: readonly { id: string }[]
  search: (sourceId: string, query: string, signal: AbortSignal) => Promise<Track[]>
  isPlayable: (track: Track, signal: AbortSignal) => Promise<boolean>
  /** Browse/library лента без поискового запроса (если адаптер умеет). */
  fetchFeed?: (sourceId: string, signal: AbortSignal) => Promise<Track[]>
  /**
   * Пагинированный search. Если нет — continuous engine использует search как одну страницу.
   * Не имитировать cursor, если адаптер его не поддерживает.
   */
  searchPage?: (
    sourceId: string,
    query: string,
    options: { cursor?: string | null; limit?: number; signal: AbortSignal },
  ) => Promise<RecommendationDiscoveryPage>
  /**
   * Пагинированный feed/library. Для Yandex fetchTracks — библиотека пользователя, не весь каталог.
   */
  fetchFeedPage?: (
    sourceId: string,
    options: { cursor?: string | null; limit?: number; signal: AbortSignal },
  ) => Promise<RecommendationDiscoveryPage>
}

export type RecommendationExcludedTrack = {
  id?: string
  title: string
  artist: string
  sourceId?: string
  externalId?: string
}

export type RecommendationRequest = {
  mode: RecommendationMode
  /** Текущая композиция или null для автоматического старта. */
  current: Track | null
  taste: UserTasteProfile | null
  /** Уже предложенные / очередь / история / лайк-сиды для исключения. */
  excluded: readonly RecommendationExcludedTrack[]
  /**
   * Известная библиотека (canonical + taste scores) — один из источников кандидатов.
   * Не ограничивает весь поток: каталог ищется отдельно.
   */
  library: readonly ContinuationLibraryTrack[]
  port: RecommendationCatalogPort
  signal?: AbortSignal
  timeoutMs?: number
  /** Явная стратегия; иначе выбирается по контракту режима. */
  strategy?: RecommendationStrategy
}

export type RecommendationHit = {
  ok: true
  track: Track
  reason: RecommendationReason
  mode: RecommendationMode
}

export type RecommendationMiss = {
  ok: false
  emptyReason: RecommendationEmptyReason
  mode: RecommendationMode
  message: string
}

export type RecommendationResult = RecommendationHit | RecommendationMiss

export const RECOMMENDATION_LIMITS = {
  maxArtists: 6,
  maxPerSearch: 8,
  /** Legacy taste path only — continuous-random использует CONTINUOUS_LIMITS. */
  maxCatalogCandidates: 24,
  maxLibraryProbes: 8,
  searchTimeoutMs: 4_000,
} as const
