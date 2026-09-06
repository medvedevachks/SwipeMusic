import type {
  CollectionActionLog,
  CollectionTrackData,
} from '../types/collectionUser'
import type { CollectionStorage } from './CollectionStorage'

/** In-memory реализация — текущий runtime store без persistence. */
export class MemoryCollectionStorage implements CollectionStorage {
  private tracks = new Map<string, CollectionTrackData>()
  private actions: CollectionActionLog[] = []

  listTracks(): CollectionTrackData[] {
    return [...this.tracks.values()]
  }

  getTrack(trackId: string): CollectionTrackData | null {
    return this.tracks.get(trackId) ?? null
  }

  upsertTrack(record: CollectionTrackData): void {
    this.tracks.set(record.trackId, record)
  }

  deleteTrack(trackId: string): void {
    this.tracks.delete(trackId)
  }

  listActions(): CollectionActionLog[] {
    return [...this.actions]
  }

  appendAction(action: CollectionActionLog): void {
    this.actions.push(action)
  }

  clearActions(): void {
    this.actions = []
  }

  replaceAll(data: {
    tracks: CollectionTrackData[]
    actions: CollectionActionLog[]
  }): void {
    this.tracks = new Map(data.tracks.map((track) => [track.trackId, track]))
    this.actions = [...data.actions]
  }
}
