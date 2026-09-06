import { create } from 'zustand'
import {
  bootstrapLibraryProviders,
  libraryService,
} from '../library'
import type { LibraryNode } from '../types/libraryProvider'
import type { Track } from '../types/track'
import { getCollectionEngine } from '../services/collectionEngine'
import type { TrackMeta } from '../types/trackMeta'
import {
  defaultTrackMeta,
  trackMetaFromCollection,
} from '../types/trackMeta'

export type LibraryTrackRowModel = {
  track: Track
  meta: TrackMeta
}

type LibraryUiStore = {
  providerId: string
  providers: Array<{ id: string; label: string }>
  rootNodes: LibraryNode[]
  treeChildren: Record<string, LibraryNode[]>
  expandedIds: string[]
  selectedNodeId: string | null
  breadcrumb: LibraryNode[]
  tracks: LibraryTrackRowModel[]
  searchQuery: string
  searchResults: LibraryTrackRowModel[]
  isLoading: boolean
  error: string | null
  selectedTrackIds: string[]
  actionTrackId: string | null

  bootstrap: () => Promise<void>
  setProviderId: (providerId: string) => Promise<void>
  toggleExpand: (nodeId: string) => Promise<void>
  selectNode: (nodeId: string) => Promise<void>
  setSearchQuery: (query: string) => void
  runSearch: () => Promise<void>
  refresh: () => Promise<void>
  toggleTrackSelected: (trackId: string) => void
  selectAllTracks: () => void
  clearTrackSelection: () => void
  setActionTrackId: (trackId: string | null) => void
}

function enrichTracks(tracks: Track[]): LibraryTrackRowModel[] {
  const engine = getCollectionEngine()
  return tracks.map((track) => {
    engine.addTrack(track)
    const data = engine.listTracks({ includeHidden: true }).find(
      (item) => item.trackId === track.id,
    )
    return {
      track: data?.track ?? track,
      meta: data ? trackMetaFromCollection(data) : defaultTrackMeta(track),
    }
  })
}

async function loadRoots(): Promise<LibraryNode[]> {
  return libraryService.getRoot()
}

export const useLibraryUiStore = create<LibraryUiStore>((set, get) => ({
  providerId: 'all',
  providers: [],
  rootNodes: [],
  treeChildren: {},
  expandedIds: [],
  selectedNodeId: null,
  breadcrumb: [],
  tracks: [],
  searchQuery: '',
  searchResults: [],
  isLoading: false,
  error: null,
  selectedTrackIds: [],
  actionTrackId: null,

  bootstrap: async () => {
    set({ isLoading: true, error: null })
    try {
      bootstrapLibraryProviders()
      const providers = libraryService.listProviders()
      const rootNodes = await loadRoots()
      set({
        providers,
        rootNodes,
        isLoading: false,
      })

      if (rootNodes[0]) {
        await get().selectNode(rootNodes[0].id)
      }
    } catch (error) {
      set({
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось инициализировать библиотеку',
      })
    }
  },

  setProviderId: async (providerId) => {
    libraryService.setActiveProviderId(providerId)
    set({
      providerId,
      treeChildren: {},
      expandedIds: [],
      selectedNodeId: null,
      breadcrumb: [],
      tracks: [],
      selectedTrackIds: [],
      isLoading: true,
      error: null,
    })
    try {
      const rootNodes = await loadRoots()
      set({ rootNodes, isLoading: false })
      if (rootNodes[0]) {
        await get().selectNode(rootNodes[0].id)
      }
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Ошибка переключения',
      })
    }
  },

  toggleExpand: async (nodeId) => {
    const { expandedIds, treeChildren } = get()
    if (expandedIds.includes(nodeId)) {
      set({ expandedIds: expandedIds.filter((id) => id !== nodeId) })
      return
    }

    if (!treeChildren[nodeId]) {
      const children = await libraryService.getChildren(nodeId)
      set({
        treeChildren: { ...get().treeChildren, [nodeId]: children },
      })
    }

    set({ expandedIds: [...get().expandedIds, nodeId] })
  },

  selectNode: async (nodeId) => {
    set({
      selectedNodeId: nodeId,
      isLoading: true,
      error: null,
      searchQuery: '',
      searchResults: [],
      selectedTrackIds: [],
    })
    try {
      const [tracks, breadcrumb, children] = await Promise.all([
        libraryService.getTracks(nodeId),
        libraryService.getBreadcrumb(nodeId),
        libraryService.getChildren(nodeId),
      ])

      set({
        tracks: enrichTracks(tracks),
        breadcrumb,
        treeChildren: { ...get().treeChildren, [nodeId]: children },
        isLoading: false,
      })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Ошибка загрузки узла',
      })
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  runSearch: async () => {
    const query = get().searchQuery.trim()
    if (!query) {
      set({ searchResults: [] })
      return
    }
    set({ isLoading: true, error: null })
    try {
      const tracks = await libraryService.search(query)
      set({
        searchResults: enrichTracks(tracks),
        isLoading: false,
        selectedNodeId: null,
        breadcrumb: [],
      })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Ошибка поиска',
      })
    }
  },

  refresh: async () => {
    set({ isLoading: true, error: null })
    try {
      await libraryService.refresh()
      const rootNodes = await loadRoots()
      set({
        rootNodes,
        treeChildren: {},
        expandedIds: [],
        isLoading: false,
      })
      const selected = get().selectedNodeId
      if (selected) {
        await get().selectNode(selected)
      }
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Ошибка обновления',
      })
    }
  },

  toggleTrackSelected: (trackId) => {
    const selected = get().selectedTrackIds
    set({
      selectedTrackIds: selected.includes(trackId)
        ? selected.filter((id) => id !== trackId)
        : [...selected, trackId],
    })
  },

  selectAllTracks: () => {
    const rows = get().searchResults.length > 0 ? get().searchResults : get().tracks
    set({ selectedTrackIds: rows.map((row) => row.track.id) })
  },

  clearTrackSelection: () => set({ selectedTrackIds: [] }),

  setActionTrackId: (trackId) => set({ actionTrackId: trackId }),
}))
