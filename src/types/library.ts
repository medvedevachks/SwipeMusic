/**
 * Секции библиотеки — реестр расширяется без правок UI-движка.
 */
export type LibrarySectionId =
  | 'all'
  | 'folders'
  | 'artists'
  | 'albums'
  | 'categories'
  | 'favorites'
  | 'recently-added'
  | 'recently-played'
  | 'most-played'
  | 'never-played'
  | 'most-skipped'
  | 'sources'

export type LibrarySortField =
  | 'title'
  | 'artist'
  | 'album'
  | 'addedAt'
  | 'lastPlayedAt'
  | 'playCount'
  | 'skipCount'
  | 'duration'
  | 'source'

export type LibrarySortDirection = 'asc' | 'desc'

export type LibraryFilters = {
  query: string
  sourceIds: string[]
  categoryIds: string[]
  artists: string[]
  albums: string[]
  likedOnly: boolean
  hasCategories: boolean | null
  hasCover: boolean | null
  durationMinMs: number | null
  durationMaxMs: number | null
  playCountMin: number | null
  playCountMax: number | null
  skipCountMin: number | null
  skipCountMax: number | null
  /** Группа внутри секции (artist/album/folder/category/source id). */
  groupKey: string | null
}

export type LibraryQueryState = {
  section: LibrarySectionId
  filters: LibraryFilters
  sortField: LibrarySortField
  sortDirection: LibrarySortDirection
}

export type LibraryGroup = {
  key: string
  label: string
  count: number
}

export type LibrarySectionDefinition = {
  id: LibrarySectionId
  label: string
  /** Секция показывает группы, затем треки. */
  isGrouped: boolean
  /** Скрывать, если нет данных (напр. folders без local). */
  requiresLocalFiles?: boolean
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  query: '',
  sourceIds: [],
  categoryIds: [],
  artists: [],
  albums: [],
  likedOnly: false,
  hasCategories: null,
  hasCover: null,
  durationMinMs: null,
  durationMaxMs: null,
  playCountMin: null,
  playCountMax: null,
  skipCountMin: null,
  skipCountMax: null,
  groupKey: null,
}

export const LIBRARY_SECTIONS: readonly LibrarySectionDefinition[] = [
  { id: 'all', label: 'Все треки', isGrouped: false },
  { id: 'folders', label: 'Папки', isGrouped: true, requiresLocalFiles: true },
  { id: 'artists', label: 'Исполнители', isGrouped: true },
  { id: 'albums', label: 'Альбомы', isGrouped: true },
  { id: 'categories', label: 'Категории', isGrouped: true },
  { id: 'favorites', label: 'Избранное', isGrouped: false },
  { id: 'recently-added', label: 'Недавно добавленные', isGrouped: false },
  { id: 'recently-played', label: 'Недавно прослушанные', isGrouped: false },
  { id: 'most-played', label: 'Часто прослушиваемые', isGrouped: false },
  { id: 'never-played', label: 'Никогда не прослушанные', isGrouped: false },
  { id: 'most-skipped', label: 'Часто пропускаемые', isGrouped: false },
  { id: 'sources', label: 'Источники', isGrouped: true },
] as const
