import { create } from 'zustand'
import type { Track } from '../types/track'

/**
 * Сессия колоды свайпов.
 * Search передаёт сюда Track[] — Home/useSwipeFeed читает без правок Swipe Engine.
 */
type SwipeDeckSessionState = {
  mode: 'catalog' | 'search'
  tracks: Track[] | null
  searchQuery: string | null

  /** Результаты поиска становятся новой колодой; selected — первым. */
  applySearchDeck: (tracks: Track[], options?: {
    selectedTrackId?: string
    query?: string
  }) => void

  resetToCatalog: () => void
}

export const useSwipeDeckSessionStore = create<SwipeDeckSessionState>((set) => ({
  mode: 'catalog',
  tracks: null,
  searchQuery: null,

  applySearchDeck: (tracks, options = {}) => {
    if (tracks.length === 0) {
      return
    }

    let ordered = [...tracks]
    if (options.selectedTrackId) {
      const index = ordered.findIndex((track) => track.id === options.selectedTrackId)
      if (index > 0) {
        const [selected] = ordered.splice(index, 1)
        ordered = [selected, ...ordered]
      }
    }

    set({
      mode: 'search',
      tracks: ordered,
      searchQuery: options.query ?? null,
    })
  },

  resetToCatalog: () => {
    set({
      mode: 'catalog',
      tracks: null,
      searchQuery: null,
    })
  },
}))
