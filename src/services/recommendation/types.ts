import type { Track } from '../../types/track.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'

/**
 * Режим вызова. В этой итерации стратегия подбора одинаковая;
 * веса новизны / близости / разнообразия появятся позже.
 */
export type RecommendationMode = 'swipe' | 'wave'

export type RecommendationReason =
  | 'catalog-artist-search'
  | 'library-like'
  | 'taste-positive'
  | 'same-artist'
  | 'known-rest'

export type RecommendationEmptyReason =
  | 'no-sources'
  | 'no-seed'
  | 'no-candidates'
  | 'all-unavailable'
  | 'aborted'
  | 'timeout'
  | 'error'

/** Порт каталога: те же контракты, что у Personal Radio search. */
export type RecommendationCatalogPort = {
  sources: readonly { id: string }[]
  search: (sourceId: string, query: string, signal: AbortSignal) => Promise<Track[]>
  isPlayable: (track: Track, signal: AbortSignal) => Promise<boolean>
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
  maxCatalogCandidates: 24,
  maxLibraryProbes: 8,
  searchTimeoutMs: 4_000,
} as const
