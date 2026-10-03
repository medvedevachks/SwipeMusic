import { create } from 'zustand'
import { getCollectionEngine } from '../services/collectionEngine/index.ts'
import {
  persistAssignment,
  persistTrackDelete,
  persistTrackRecord,
  persistUnassign,
} from '../services/libraryPersistence/mutations.ts'
import { useCollectionStore } from './collectionStore.ts'
import type {
  CollectionActionLog,
  CollectionStats,
  CollectionTrackData,
} from '../types/collectionUser'
import type { Track } from '../types/track'

type CollectionEngineStore = {
  tracks: CollectionTrackData[]
  actions: CollectionActionLog[]
  stats: CollectionStats

  addTrack: (track: Track) => CollectionTrackData
  removeTrack: (trackId: string) => void
  assignCategory: (trackId: string, categoryId: string, track?: Track) => void
  removeCategory: (trackId: string, categoryId: string) => void
  toggleLike: (trackId: string, track?: Track) => void
  setLiked: (trackId: string, liked: boolean, track?: Track) => void
  setDisliked: (trackId: string, disliked: boolean, track?: Track) => void
  toggleFavorite: (trackId: string, track?: Track) => void
  markPlayed: (trackId: string, track?: Track) => void
  markSkipped: (trackId: string, track?: Track) => void
  hideTrack: (trackId: string, track?: Track) => void
  restoreTrack: (trackId: string) => void
  refresh: () => void
}

const engine = getCollectionEngine()

function persistCurrentTrack(trackId: string): void {
  const record = engine.getTrack(trackId)
  if (!record) {
    return
  }
  const like = useCollectionStore
    .getState()
    .likedTracks.find((item) => item.trackId === trackId)
  persistTrackRecord(record, record.liked ? (like?.createdAt ?? record.addedAt) : null)
}

const emptyStats: CollectionStats = {
  totalTracks: 0,
  liked: 0,
  disliked: 0,
  favorites: 0,
  hidden: 0,
  totalPlays: 0,
  totalSkips: 0,
  byCategory: {},
  lastPlayedAt: null,
  lastPlayedTrackId: null,
}

export const useCollectionEngineStore = create<CollectionEngineStore>((set) => {
  engine.subscribe((snapshot) => {
    set({
      tracks: snapshot.tracks,
      actions: snapshot.actions,
      stats: snapshot.stats,
    })
  })

  const snap = engine.getSnapshot()

  return {
    tracks: snap.tracks,
    actions: snap.actions,
    stats: snap.stats.totalTracks ? snap.stats : emptyStats,

    addTrack: (track) => engine.addTrack(track),
    removeTrack: (trackId) => {
      engine.removeTrack(trackId)
      persistTrackDelete(trackId)
    },
    assignCategory: (trackId, categoryId, track) => {
      const updated = engine.assignCategory(trackId, categoryId, track)
      const snapshot = updated?.track ?? track
      if (!snapshot) {
        return
      }
      const assignment = useCollectionStore.getState().ensureAssignment(trackId, categoryId)
      persistAssignment(snapshot, assignment)
      persistCurrentTrack(trackId)
    },
    removeCategory: (trackId, categoryId) => {
      engine.removeCategory(trackId, categoryId)
      useCollectionStore.getState().removeAssignment(trackId, categoryId)
      persistUnassign(trackId, categoryId)
      persistCurrentTrack(trackId)
    },
    toggleLike: (trackId, track) => {
      const updated = engine.toggleLike(trackId, track)
      if (!updated) {
        return
      }
      useCollectionStore.getState().mirrorLike(trackId, updated.liked)
      persistCurrentTrack(trackId)
    },
    setLiked: (trackId, liked, track) => {
      const updated = engine.setLiked(trackId, liked, track)
      if (!updated) {
        return
      }
      useCollectionStore.getState().mirrorLike(trackId, liked)
      persistCurrentTrack(trackId)
    },
    setDisliked: (trackId, disliked, track) => {
      engine.setDisliked(trackId, disliked, track)
      if (disliked) {
        useCollectionStore.getState().mirrorLike(trackId, false)
      }
      persistCurrentTrack(trackId)
    },
    toggleFavorite: (trackId, track) => {
      engine.toggleFavorite(trackId, track)
      persistCurrentTrack(trackId)
    },
    markPlayed: (trackId, track) => {
      engine.markPlayed(trackId, track)
      persistCurrentTrack(trackId)
    },
    markSkipped: (trackId, track) => {
      engine.markSkipped(trackId, track)
      persistCurrentTrack(trackId)
    },
    hideTrack: (trackId, track) => {
      engine.hideTrack(trackId, track)
      persistCurrentTrack(trackId)
    },
    restoreTrack: (trackId) => {
      engine.restoreTrack(trackId)
      persistCurrentTrack(trackId)
    },
    refresh: () => {
      const next = engine.getSnapshot()
      set({
        tracks: next.tracks,
        actions: next.actions,
        stats: next.stats,
      })
    },
  }
})
