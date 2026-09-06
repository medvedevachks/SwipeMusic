import type { CollectionStorage } from '../../storage/CollectionStorage'
import { MemoryCollectionStorage } from '../../storage/MemoryCollectionStorage'
import type {
  CollectionActionLog,
  CollectionEngineSnapshot,
  CollectionStats,
  CollectionTrackData,
  CollectionUserActionType,
} from '../../types/collectionUser'
import type { Track } from '../../types/track'
import { createId } from '../../utils/id'

type Listener = (snapshot: CollectionEngineSnapshot) => void

type UpdateTrackPatch = Partial<
  Pick<
    CollectionTrackData,
    | 'notes'
    | 'liked'
    | 'disliked'
    | 'favorite'
    | 'hidden'
    | 'categories'
    | 'customMetadata'
    | 'playCount'
    | 'lastPlayed'
    | 'skipped'
  >
>

/**
 * Collection Engine — пользовательская коллекция независимо от источников.
 * Без React / UI / Swipe / Search / Player.
 */
export class CollectionEngine {
  private readonly storage: CollectionStorage
  private readonly listeners = new Set<Listener>()

  constructor(storage: CollectionStorage = new MemoryCollectionStorage()) {
    this.storage = storage
  }

  getSnapshot(): CollectionEngineSnapshot {
    const tracks = this.storage.listTracks()
    const actions = this.storage.listActions()
    return {
      tracks,
      actions,
      stats: this.computeStats(tracks),
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  addTrack(track: Track): CollectionTrackData {
    const existing = this.storage.getTrack(track.id)
    if (existing) {
      const merged: CollectionTrackData = {
        ...existing,
        track,
        sourceId: track.sourceId,
      }
      this.storage.upsertTrack(merged)
      this.emit()
      return merged
    }

    const record = this.createRecord(track)
    this.storage.upsertTrack(record)
    this.log('added', track.id, track.sourceId)
    this.emit()
    return record
  }

  removeTrack(trackId: string): void {
    const existing = this.storage.getTrack(trackId)
    if (!existing) {
      return
    }
    this.storage.deleteTrack(trackId)
    this.log('removed', trackId, existing.sourceId)
    this.emit()
  }

  updateTrack(trackId: string, patch: UpdateTrackPatch): CollectionTrackData | null {
    const existing = this.storage.getTrack(trackId)
    if (!existing) {
      return null
    }

    const updated: CollectionTrackData = {
      ...existing,
      ...patch,
      categories: patch.categories ? [...patch.categories] : existing.categories,
      customMetadata: patch.customMetadata
        ? { ...existing.customMetadata, ...patch.customMetadata }
        : existing.customMetadata,
    }

    this.storage.upsertTrack(updated)
    this.log('updated', trackId, existing.sourceId, { patch: Object.keys(patch) })
    this.emit()
    return updated
  }

  assignCategory(
    trackId: string,
    categoryId: string,
    track?: Track,
  ): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    if (existing.categories.includes(categoryId)) {
      return existing
    }

    const updated: CollectionTrackData = {
      ...existing,
      categories: [...existing.categories, categoryId],
    }
    this.storage.upsertTrack(updated)
    this.log('added_to_category', trackId, existing.sourceId, { categoryId })
    this.log('swiped_right', trackId, existing.sourceId, { categoryId })
    this.emit()
    return updated
  }

  removeCategory(trackId: string, categoryId: string): CollectionTrackData | null {
    const existing = this.storage.getTrack(trackId)
    if (!existing) {
      return null
    }

    const updated: CollectionTrackData = {
      ...existing,
      categories: existing.categories.filter((id) => id !== categoryId),
    }
    this.storage.upsertTrack(updated)
    this.log('removed_from_category', trackId, existing.sourceId, { categoryId })
    this.emit()
    return updated
  }

  toggleLike(trackId: string, track?: Track): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    return existing.liked
      ? this.setLiked(trackId, false)
      : this.setLiked(trackId, true, track)
  }

  setLiked(
    trackId: string,
    liked: boolean,
    track?: Track,
  ): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    if (existing.liked === liked) {
      return existing
    }

    const updated: CollectionTrackData = {
      ...existing,
      liked,
      disliked: liked ? false : existing.disliked,
    }
    this.storage.upsertTrack(updated)
    this.log(liked ? 'liked' : 'unliked', trackId, existing.sourceId)
    if (liked) {
      this.log('swiped_left', trackId, existing.sourceId)
    }
    this.emit()
    return updated
  }

  toggleFavorite(trackId: string, track?: Track): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    const favorite = !existing.favorite
    const updated: CollectionTrackData = { ...existing, favorite }
    this.storage.upsertTrack(updated)
    this.log(favorite ? 'favorited' : 'unfavorited', trackId, existing.sourceId)
    this.emit()
    return updated
  }

  markPlayed(trackId: string, track?: Track): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()
    const updated: CollectionTrackData = {
      ...existing,
      playCount: existing.playCount + 1,
      lastPlayed: now,
    }
    this.storage.upsertTrack(updated)
    this.log('played', trackId, existing.sourceId)
    this.emit()
    return updated
  }

  markSkipped(trackId: string, track?: Track): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }

    const updated: CollectionTrackData = {
      ...existing,
      skipped: existing.skipped + 1,
    }
    this.storage.upsertTrack(updated)
    this.log('skipped', trackId, existing.sourceId)
    this.log('swiped_up', trackId, existing.sourceId)
    this.emit()
    return updated
  }

  hideTrack(trackId: string, track?: Track): CollectionTrackData | null {
    let existing = this.storage.getTrack(trackId)
    if (!existing && track) {
      existing = this.addTrack(track)
    }
    if (!existing) {
      return null
    }
    const updated: CollectionTrackData = { ...existing, hidden: true }
    this.storage.upsertTrack(updated)
    this.log('hidden', trackId, existing.sourceId)
    this.emit()
    return updated
  }

  restoreTrack(trackId: string): CollectionTrackData | null {
    const existing = this.storage.getTrack(trackId)
    if (!existing) {
      return null
    }
    const updated: CollectionTrackData = { ...existing, hidden: false }
    this.storage.upsertTrack(updated)
    this.log('restored', trackId, existing.sourceId)
    this.emit()
    return updated
  }

  getTrack(trackId: string): CollectionTrackData | null {
    return this.storage.getTrack(trackId)
  }

  listTracks(options?: { includeHidden?: boolean }): CollectionTrackData[] {
    const includeHidden = options?.includeHidden ?? false
    return this.storage
      .listTracks()
      .filter((track) => includeHidden || !track.hidden)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  }

  getStats(): CollectionStats {
    return this.computeStats(this.storage.listTracks())
  }

  getActions(): CollectionActionLog[] {
    return this.storage.listActions()
  }

  /** Для будущего ImportService / смены storage. */
  replaceStorageData(data: {
    tracks: CollectionTrackData[]
    actions: CollectionActionLog[]
  }): void {
    this.storage.replaceAll(data)
    this.emit()
  }

  private createRecord(track: Track): CollectionTrackData {
    return {
      trackId: track.id,
      sourceId: track.sourceId,
      track,
      addedAt: new Date().toISOString(),
      lastPlayed: null,
      playCount: 0,
      liked: false,
      disliked: false,
      skipped: 0,
      categories: [],
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    }
  }

  private log(
    action: CollectionUserActionType,
    trackId: string,
    sourceId: string,
    meta?: Record<string, unknown>,
  ): void {
    this.storage.appendAction({
      id: createId('cact'),
      timestamp: new Date().toISOString(),
      action,
      trackId,
      sourceId,
      meta,
    })
  }

  private computeStats(tracks: CollectionTrackData[]): CollectionStats {
    const byCategory: Record<string, number> = {}
    let liked = 0
    let disliked = 0
    let favorites = 0
    let hidden = 0
    let totalPlays = 0
    let totalSkips = 0
    let lastPlayedAt: string | null = null
    let lastPlayedTrackId: string | null = null

    for (const item of tracks) {
      if (item.liked) liked += 1
      if (item.disliked) disliked += 1
      if (item.favorite) favorites += 1
      if (item.hidden) hidden += 1
      totalPlays += item.playCount
      totalSkips += item.skipped

      for (const categoryId of item.categories) {
        byCategory[categoryId] = (byCategory[categoryId] ?? 0) + 1
      }

      if (
        item.lastPlayed &&
        (!lastPlayedAt || item.lastPlayed > lastPlayedAt)
      ) {
        lastPlayedAt = item.lastPlayed
        lastPlayedTrackId = item.trackId
      }
    }

    return {
      totalTracks: tracks.length,
      liked,
      disliked,
      favorites,
      hidden,
      totalPlays,
      totalSkips,
      byCategory,
      lastPlayedAt,
      lastPlayedTrackId,
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

let singleton: CollectionEngine | null = null

export function getCollectionEngine(): CollectionEngine {
  if (!singleton) {
    singleton = new CollectionEngine()
  }
  return singleton
}
