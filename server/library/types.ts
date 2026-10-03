/** ISO 8601 UTC. Один формат для всех таблиц и ответов MVP-02A. */
export type IsoTimestamp = string

export type SwipeAction = 'categorize' | 'like' | 'skip' | 'previous'

export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

export type GestureConfig = Record<SwipeDirection, SwipeAction>

export type CategoryIconId =
  | 'heart'
  | 'car'
  | 'muscle'
  | 'moon'
  | 'party'
  | 'book'
  | 'music'
  | 'star'

/**
 * Wire-форма каталога. Таблица и JSON по-прежнему называются category:
 * это те же строки, что пользователь уже сохранил.
 */
export type CategoryDto = {
  id: string
  name: string
  icon: CategoryIconId
  color: string
  description: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
  sortOrder: number
  favorite: boolean
  system: boolean
}

/** Продуктовое имя той же DTO. Отдельной таблицы catalogs нет. */
export type CatalogDto = CategoryDto

/** Совпадает с `Track` из src/types/track.ts. Playback URL сюда не входит. */
export type TrackSnapshot = {
  id: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  durationMs?: number
  coverUrl?: string | null
  coverColor?: string
  previewUrl?: string | null
  tags?: string[]
}

/**
 * Снимок Collection Engine плюс `likedAt`.
 * `likedAt` — момент like на той же строке трека, отдельной таблицы лайков нет.
 */
export type CollectionTrackDto = {
  trackId: string
  sourceId: string
  track: TrackSnapshot
  addedAt: IsoTimestamp
  lastPlayed: string | null
  playCount: number
  liked: boolean
  likedAt: string | null
  disliked: boolean
  skipped: number
  categories: string[]
  notes: string
  favorite: boolean
  hidden: boolean
  customMetadata: Record<string, unknown>
}

/** Совпадает с `TrackAssignment`. */
export type AssignmentDto = {
  id: string
  trackId: string
  categoryId: string
  createdAt: IsoTimestamp
}

/** Совпадает с `HistoryEntry`. */
export type HistoryEntryDto = {
  id: string
  track: TrackSnapshot
  action: SwipeAction
  category?: CategoryDto
  createdAt: IsoTimestamp
  sourceId: string
}

export type UserSettingsDto = {
  gestureConfig: GestureConfig
}

export type LibraryStateDto = {
  categories: CategoryDto[]
  tracks: CollectionTrackDto[]
  categoryAssignments: AssignmentDto[]
  history: HistoryEntryDto[]
  settings: UserSettingsDto
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  right: 'categorize',
  left: 'like',
  up: 'skip',
  down: 'previous',
}

export const HISTORY_DEFAULT_LIMIT = 100
export const HISTORY_MAX_LIMIT = 200
