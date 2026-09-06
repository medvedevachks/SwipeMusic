import type {
  CollectionActionLog,
  CollectionTrackData,
} from '../types/collectionUser'

/**
 * Абстракция хранилища коллекции.
 * Реализации: Memory → IndexedDB / SQLite / Supabase / Firebase / PostgreSQL.
 */
export interface CollectionStorage {
  listTracks(): CollectionTrackData[]
  getTrack(trackId: string): CollectionTrackData | null
  upsertTrack(record: CollectionTrackData): void
  deleteTrack(trackId: string): void

  listActions(): CollectionActionLog[]
  appendAction(action: CollectionActionLog): void
  clearActions(): void

  replaceAll(data: {
    tracks: CollectionTrackData[]
    actions: CollectionActionLog[]
  }): void
}
