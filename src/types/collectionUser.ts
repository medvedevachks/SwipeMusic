import type { Track } from './track'

/**
 * Пользовательские данные о треке.
 * Отделены от Track (метаданные источника).
 */
export type CollectionTrackData = {
  trackId: string
  sourceId: string
  /** Снимок трека на момент добавления — источник может исчезнуть. */
  track: Track
  addedAt: string
  lastPlayed: string | null
  playCount: number
  liked: boolean
  disliked: boolean
  skipped: number
  categories: string[]
  notes: string
  favorite: boolean
  hidden: boolean
  customMetadata: Record<string, unknown>
}

export type CollectionUserActionType =
  | 'added'
  | 'removed'
  | 'swiped_right'
  | 'swiped_left'
  | 'swiped_up'
  | 'swiped_down'
  | 'added_to_category'
  | 'removed_from_category'
  | 'liked'
  | 'unliked'
  | 'disliked'
  | 'favorited'
  | 'unfavorited'
  | 'played'
  | 'skipped'
  | 'hidden'
  | 'restored'
  | 'updated'

export type CollectionActionLog = {
  id: string
  timestamp: string
  action: CollectionUserActionType
  trackId: string
  sourceId: string
  meta?: Record<string, unknown>
}

export type CollectionStats = {
  totalTracks: number
  liked: number
  disliked: number
  favorites: number
  hidden: number
  totalPlays: number
  totalSkips: number
  byCategory: Record<string, number>
  lastPlayedAt: string | null
  lastPlayedTrackId: string | null
}

export type CollectionEngineSnapshot = {
  tracks: CollectionTrackData[]
  actions: CollectionActionLog[]
  stats: CollectionStats
}
