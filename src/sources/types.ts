import type { Track } from '../types/track'
import type {
  MusicSource,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types/musicSource'

export type { MusicSource, MusicSourceCapability, MusicSourceKind }

export type FetchTracksParams = {
  limit?: number
  cursor?: string | null
  query?: string
  signal?: AbortSignal
}

export type FetchTracksResult = {
  tracks: Track[]
  nextCursor?: string | null
}

/** @deprecated Используйте MusicSource из `src/types/musicSource`. */
export type MusicSourceDescriptor = MusicSource
