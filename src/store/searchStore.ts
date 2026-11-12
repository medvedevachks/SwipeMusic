import { create } from 'zustand'
import {
  bumpArtistSearchGeneration,
  getArtistSearchGeneration,
  getCatalogBrowseService,
  isCurrentArtistSearchGeneration,
} from '../services/catalogBrowse'
import { getSearchEngine } from '../services/searchEngine'
import type { CatalogArtist } from '../types/catalog'
import type { Track } from '../types/track'
import {
  bindSearchHistoryUser,
  persistSearchHistory,
  registerSearchHistoryHost,
} from './searchHistoryBind.ts'
import { SEARCH_HISTORY_MAX } from './searchHistoryPersistence.ts'

const MAX_RECENT = SEARCH_HISTORY_MAX

type SearchStoreState = {
  query: string
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  results: Track[]
  artists: CatalogArtist[]
  artistsLoading: boolean
  artistsLoadingMore: boolean
  artistsHasMore: boolean
  artistSourceCursors: Record<string, string | null>
  catalogWarnings: string[]
  error: string | null
  providerWarnings: string[]
  activeSources: string[]
  lastSearchTime: number | null
  recentSearches: string[]

  setQuery: (query: string) => void
  search: (query?: string) => Promise<Track[]>
  searchNext: () => Promise<Track[]>
  searchArtistsNext: () => Promise<CatalogArtist[]>
  cancel: () => void
  clear: () => void

  addRecentSearch: (query: string) => void
  removeRecentSearch: (query: string) => void
  clearHistory: () => void
}

const searchEngine = getSearchEngine()
const catalog = getCatalogBrowseService()

let artistsAbort: AbortController | null = null

function abortArtistsRequest(): void {
  artistsAbort?.abort()
  artistsAbort = null
}

function mergeArtists(
  existing: readonly CatalogArtist[],
  incoming: readonly CatalogArtist[],
): CatalogArtist[] {
  const seen = new Set(existing.map((artist) => artist.id))
  const merged = [...existing]
  for (const artist of incoming) {
    if (seen.has(artist.id)) {
      continue
    }
    seen.add(artist.id)
    merged.push(artist)
  }
  return merged
}

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
    artists: [],
    artistsLoading: false,
    artistsLoadingMore: false,
    artistsHasMore: false,
    artistSourceCursors: {},
    catalogWarnings: [],
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

      abortArtistsRequest()
      const generation = bumpArtistSearchGeneration()
      const controller = new AbortController()
      artistsAbort = controller

      set({
        query: nextQuery,
        artists: [],
        artistsLoading: true,
        artistsLoadingMore: false,
        artistsHasMore: false,
        artistSourceCursors: {},
        catalogWarnings: [],
      })

      const artistsPromise = catalog
        .searchArtists(nextQuery, { signal: controller.signal })
        .then((result) => {
          if (!isCurrentArtistSearchGeneration(generation)) {
            return
          }
          if (controller.signal.aborted) {
            return
          }
          set({
            artists: result.artists,
            catalogWarnings: result.warnings,
            artistsLoading: false,
            artistsHasMore: result.hasMore,
            artistSourceCursors: result.sourceCursors,
          })
        })
        .catch((error) => {
          if (!isCurrentArtistSearchGeneration(generation)) {
            return
          }
          if (controller.signal.aborted) {
            return
          }
          set({
            artists: [],
            artistsLoading: false,
            artistsHasMore: false,
            artistSourceCursors: {},
            catalogWarnings: [
              error instanceof Error ? error.message : String(error),
            ],
          })
        })

      try {
        const results = await searchEngine.search(nextQuery)
        get().addRecentSearch(nextQuery)
        await artistsPromise
        return results
      } catch {
        await artistsPromise
        return []
      } finally {
        if (artistsAbort === controller) {
          artistsAbort = null
        }
      }
    },

    searchNext: () => searchEngine.searchNext(),

    searchArtistsNext: async () => {
      const state = get()
      if (
        !state.query ||
        !state.artistsHasMore ||
        state.artistsLoading ||
        state.artistsLoadingMore
      ) {
        return state.artists
      }

      const pending = Object.entries(state.artistSourceCursors).filter(
        ([, cursor]) => cursor != null && cursor !== '',
      )
      if (pending.length === 0) {
        set({ artistsHasMore: false })
        return state.artists
      }

      const generation = getArtistSearchGeneration()
      const controller = new AbortController()
      artistsAbort = controller
      set({ artistsLoadingMore: true })

      try {
        const result = await catalog.searchArtists(state.query, {
          signal: controller.signal,
          sourceCursors: state.artistSourceCursors,
        })
        if (!isCurrentArtistSearchGeneration(generation)) {
          return get().artists
        }
        if (controller.signal.aborted) {
          return get().artists
        }
        const artists = mergeArtists(state.artists, result.artists)
        set({
          artists,
          catalogWarnings: result.warnings,
          artistsLoadingMore: false,
          artistsHasMore: result.hasMore,
          artistSourceCursors: result.sourceCursors,
        })
        return artists
      } catch (error) {
        if (!isCurrentArtistSearchGeneration(generation)) {
          return get().artists
        }
        if (controller.signal.aborted) {
          return get().artists
        }
        set({
          artistsLoadingMore: false,
          catalogWarnings: [
            ...state.catalogWarnings,
            error instanceof Error ? error.message : String(error),
          ],
        })
        return get().artists
      } finally {
        if (artistsAbort === controller) {
          artistsAbort = null
        }
      }
    },

    cancel: () => {
      searchEngine.cancel()
      abortArtistsRequest()
      bumpArtistSearchGeneration()
    },

    clear: () => {
      abortArtistsRequest()
      bumpArtistSearchGeneration()
      searchEngine.clear()
      set({
        query: '',
        loading: false,
        loadingMore: false,
        hasMore: false,
        results: [],
        artists: [],
        artistsLoading: false,
        artistsLoadingMore: false,
        artistsHasMore: false,
        artistSourceCursors: {},
        catalogWarnings: [],
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
        const recentSearches = [normalized, ...without].slice(0, MAX_RECENT)
        persistSearchHistory(recentSearches)
        return { recentSearches }
      })
    },

    removeRecentSearch: (query) => {
      set((state) => {
        const recentSearches = state.recentSearches.filter(
          (item) => item !== query,
        )
        persistSearchHistory(recentSearches)
        return { recentSearches }
      })
    },

    clearHistory: () => {
      persistSearchHistory([])
      set({ recentSearches: [] })
    },
  }
})

registerSearchHistoryHost({
  setRecentSearches: (items) => {
    useSearchStore.setState({ recentSearches: items })
  },
})
// Гостевой bucket до /me; login/logout/restore переключат владельца.
bindSearchHistoryUser(null)
