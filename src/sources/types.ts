import type { Track } from '../types/track'

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

/** Результат поиска — единый формат для всех адаптеров. */
export type SearchResult = FetchTracksResult

export type {
  MusicSource,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types/musicSource'

/** @deprecated Используйте MusicSource из `src/types/musicSource`. */
export type { MusicSource as MusicSourceDescriptor } from '../types/musicSource'
