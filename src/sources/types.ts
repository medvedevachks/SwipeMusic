import type { Track } from '../types/track'

/** Тип поставщика — влияет на UI/настройки, не на бизнес-логику свайпов. */
export type MusicSourceKind =
  | 'mock'
  | 'official-api'
  | 'local-folder'
  | 'web'

export type MusicSourceCapability =
  | 'browse'
  | 'search'
  | 'library'
  | 'recommendations'
  | 'preview'
  | 'auth'

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

export type MusicSourceDescriptor = {
  id: string
  label: string
  kind: MusicSourceKind
  capabilities: readonly MusicSourceCapability[]
}
