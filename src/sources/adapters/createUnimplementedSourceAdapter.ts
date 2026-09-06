import type { MusicSourceAdapter } from '../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types'
import type { SourceType } from '../../types/source'
import type { Track } from '../../types/track'

type StubAdapterOptions = {
  id: string
  label: string
  type: SourceType
  kind: MusicSourceKind
  capabilities?: readonly MusicSourceCapability[]
  supportsSearch?: boolean
  supportsStreaming?: boolean
  supportsPagination?: boolean
}

/**
 * Базовая заготовка адаптера: безопасна для merge-ленты (пустые результаты).
 */
export function createUnimplementedSourceAdapter(
  options: StubAdapterOptions,
): MusicSourceAdapter {
  const capabilities = options.capabilities ?? (['browse'] as const)

  return {
    id: options.id,
    label: options.label,
    type: options.type,
    kind: options.kind,
    capabilities,
    supportsSearch: options.supportsSearch ?? capabilities.includes('search'),
    supportsStreaming:
      options.supportsStreaming ?? capabilities.includes('preview'),
    supportsPagination: options.supportsPagination ?? false,

    async initialize() {},

    isAvailable() {
      return false
    },

    async fetchTracks(_params?: FetchTracksParams): Promise<FetchTracksResult> {
      return { tracks: [], nextCursor: null }
    },

    async search(
      _query: string,
      _params?: Omit<FetchTracksParams, 'query'>,
    ): Promise<FetchTracksResult> {
      return { tracks: [], nextCursor: null }
    },

    async getTrack(_trackId: string): Promise<Track | null> {
      return null
    },

    async getStream(track: Track): Promise<string> {
      if (track.previewUrl) {
        return track.previewUrl
      }
      throw new Error(`[${options.id}] Stream is not available`)
    },

    async getCover(track: Track): Promise<string | undefined> {
      return track.coverUrl ?? undefined
    },

    async dispose() {},
  }
}
