import type { MusicSourceAdapter, SearchResult } from '../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types'
import type { SourceType } from '../../types/source'
import type { Track } from '../../types/track'

/**
 * База для официальных API (Spotify, Yandex, Deezer…).
 * Конкретные сервисы — отдельные классы без правок UI.
 */
export abstract class ApiMusicAdapter implements MusicSourceAdapter {
  readonly type: SourceType = 'api'
  readonly kind: MusicSourceKind = 'official-api'

  abstract readonly id: string
  abstract readonly label: string

  readonly capabilities: readonly MusicSourceCapability[] = [
    'browse',
    'search',
    'library',
    'preview',
    'auth',
  ]

  readonly supportsSearch = true
  readonly supportsStreaming = true
  readonly supportsPagination = true

  async initialize(): Promise<void> {}

  isAvailable(): boolean {
    return false
  }

  async dispose(): Promise<void> {}

  async fetchTracks(_params?: FetchTracksParams): Promise<FetchTracksResult> {
    return { tracks: [], nextCursor: null }
  }

  async search(
    _query: string,
    _params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult> {
    return { tracks: [], nextCursor: null }
  }

  async getTrack(_trackId: string): Promise<Track | null> {
    return null
  }

  async getStream(track: Track): Promise<string> {
    if (track.previewUrl) {
      return track.previewUrl
    }
    throw new Error(`[${this.id}] Stream URL is not available`)
  }

  async getCover(track: Track): Promise<string | undefined> {
    return track.coverUrl ?? undefined
  }
}
