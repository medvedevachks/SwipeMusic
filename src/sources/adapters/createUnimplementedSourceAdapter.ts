import type { MusicSourceAdapter } from '../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types'
import type { Track } from '../../types/track'

type StubAdapterOptions = {
  id: string
  label: string
  kind: MusicSourceKind
  capabilities?: readonly MusicSourceCapability[]
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
    kind: options.kind,
    capabilities,

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

    async dispose() {},
  }
}
