import { create } from 'zustand'
import { getCollectionEngine } from '../services/collectionEngine'
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
  toggleFavorite: (trackId: string, track?: Track) => void
  markPlayed: (trackId: string, track?: Track) => void
  markSkipped: (trackId: string, track?: Track) => void
  hideTrack: (trackId: string, track?: Track) => void
  restoreTrack: (trackId: string) => void
  refresh: () => void
}

const engine = getCollectionEngine()

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
    removeTrack: (trackId) => engine.removeTrack(trackId),
    assignCategory: (trackId, categoryId, track) => {
      engine.assignCategory(trackId, categoryId, track)
    },
    removeCategory: (trackId, categoryId) => {
      engine.removeCategory(trackId, categoryId)
    },
    toggleLike: (trackId, track) => {
      engine.toggleLike(trackId, track)
    },
    setLiked: (trackId, liked, track) => {
      engine.setLiked(trackId, liked, track)
    },
    toggleFavorite: (trackId, track) => {
      engine.toggleFavorite(trackId, track)
    },
    markPlayed: (trackId, track) => {
      engine.markPlayed(trackId, track)
    },
    markSkipped: (trackId, track) => {
      engine.markSkipped(trackId, track)
    },
    hideTrack: (trackId, track) => {
      engine.hideTrack(trackId, track)
    },
    restoreTrack: (trackId) => {
      engine.restoreTrack(trackId)
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
