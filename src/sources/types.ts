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
  | 'metadata'
  | 'libraryImport'
  | 'librarySync'
  | 'playback'
  | 'externalOpen'

export const CAPABILITY_LABELS: Record<MusicSourceCapability, string> = {
  browse: 'Обзор',
  search: 'Поиск',
  library: 'Медиатека сервиса',
  recommendations: 'Рекомендации',
  preview: 'Превью',
  auth: 'Авторизация сервиса',
  metadata: 'Метаданные с сервера',
  libraryImport: 'Импорт коллекции',
  librarySync: 'Синхронизация аккаунта',
  playback: 'Встроенное воспроизведение',
  externalOpen: 'Открыть в сервисе',
}

export function hasCapability(
  capabilities: readonly MusicSourceCapability[],
  capability: MusicSourceCapability,
): boolean {
  return capabilities.includes(capability)
}

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

export type ManualSourceEntryInput = {
  title: string
  artist: string
  pageUrl: string
}

export type MusicSourceDescriptor = {
  id: string
  label: string
  kind: MusicSourceKind
  capabilities: readonly MusicSourceCapability[]
  connectionNote: string
}
