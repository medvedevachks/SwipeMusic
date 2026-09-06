import type { Track } from '../types/track'
import type { PlaybackCandidate } from '../services/playbackResolver'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from './types'
import type { MusicSource } from '../types/musicSource'
import type { SourceType } from '../types/source'

/** Результат поиска — тот же контракт, что и лента Track[]. */
export type SearchResult = FetchTracksResult

/**
 * Единый контракт любого источника музыки.
 * UI / Swipe / Search / Player не знают конкретных Spotify/Zaycev/FS.
 */
export interface MusicSourceAdapter extends MusicSource {
  readonly id: string
  readonly label: string
  readonly type: SourceType
  readonly kind: MusicSourceKind
  readonly capabilities: readonly MusicSourceCapability[]

  readonly supportsSearch: boolean
  readonly supportsStreaming: boolean
  readonly supportsPagination: boolean

  initialize(): void | Promise<void>
  isAvailable(): boolean | Promise<boolean>
  fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult>
  search(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult>
  getTrack(trackId: string): Promise<Track | null>
  getStream(track: Track): Promise<string>
  /**
   * Кандидаты для PlaybackResolver (local / stream / preview / remote).
   * Без метода — Resolver использует fallback через getStream.
   */
  getPlaybackCandidates?(track: Track): Promise<PlaybackCandidate[]>
  getCover(track: Track): Promise<string | undefined>
  dispose(): void | Promise<void>
}

export type MusicSourceAdapterFactory = () => MusicSourceAdapter
