import { create } from 'zustand'
import { getSearchEngine } from '../services/searchEngine'
import type { Track } from '../types/track'

const MAX_RECENT = 20

type SearchStoreState = {
  query: string
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  results: Track[]
  error: string | null
  providerWarnings: string[]
  activeSources: string[]
  lastSearchTime: number | null
  recentSearches: string[]

  setQuery: (query: string) => void
  search: (query?: string) => Promise<Track[]>
  searchNext: () => Promise<Track[]>
  cancel: () => void
  clear: () => void

  addRecentSearch: (query: string) => void
  removeRecentSearch: (query: string) => void
  clearHistory: () => void
}

const searchEngine = getSearchEngine()

export const useSearchStore = create<SearchStoreState>((set, get) => {
  searchEngine.subscribe((engineState) => {
    set({
      query: engineState.query,
      loading: engineState.status === 'loading',
      loadingMore: engineState.loadingMore,
      hasMore: engineState.hasMore,
      results: engineState.results,
      error: engineState.error,
      providerWarnings: engineState.providerWarnings,
      activeSources: engineState.activeSourceIds,
      lastSearchTime: engineState.lastSearchTime,
    })
  })

  return {
    query: '',
    loading: false,
    loadingMore: false,
    hasMore: false,
    results: [],
    error: null,
    providerWarnings: [],
    activeSources: [],
    lastSearchTime: null,
    recentSearches: [],

    setQuery: (query) => {
      set({ query })
    },

    search: async (query) => {
      const nextQuery = (query ?? get().query).trim()
      if (!nextQuery) {
        get().clear()
        return []
      }

      set({ query: nextQuery })
      try {
        const results = await searchEngine.search(nextQuery)
        get().addRecentSearch(nextQuery)
        return results
      } catch {
        return []
      }
    },

    searchNext: () => searchEngine.searchNext(),

    cancel: () => {
      searchEngine.cancel()
    },

    clear: () => {
      searchEngine.clear()
      set({
        query: '',
        loading: false,
        loadingMore: false,
        hasMore: false,
        results: [],
        error: null,
        providerWarnings: [],
        activeSources: [],
        lastSearchTime: null,
      })
    },

    addRecentSearch: (query) => {
      const normalized = query.trim()
      if (!normalized) {
        return
      }

      set((state) => {
        const without = state.recentSearches.filter(
          (item) => item.toLowerCase() !== normalized.toLowerCase(),
        )
        return {
          recentSearches: [normalized, ...without].slice(0, MAX_RECENT),
        }
      })
    },

    removeRecentSearch: (query) => {
      set((state) => ({
        recentSearches: state.recentSearches.filter((item) => item !== query),
      }))
    },

    clearHistory: () => {
      set({ recentSearches: [] })
    },
  }
})
