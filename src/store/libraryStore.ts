import { create } from 'zustand'
import {
  buildLibraryCatalog,
  buildLibraryGroups,
  queryLibraryEntries,
  sectionHasLocalFolders,
} from '../services/libraryEngine'
import type {
  LibraryFilters,
  LibraryGroup,
  LibrarySectionId,
  LibrarySortDirection,
  LibrarySortField,
} from '../types/library'
import { DEFAULT_LIBRARY_FILTERS, LIBRARY_SECTIONS } from '../types/library'
import type { LibraryEntry } from '../types/trackMeta'
import type { Category } from '../types/category'
import { useCollectionStore } from './collectionStore'

type LibraryStore = {
  catalog: LibraryEntry[]
  isLoading: boolean
  error: string | null
  section: LibrarySectionId
  filters: LibraryFilters
  sortField: LibrarySortField
  sortDirection: LibrarySortDirection
  selectedIds: string[]
  actionTrackId: string | null

  refresh: () => Promise<void>
  setSection: (section: LibrarySectionId) => void
  setQuery: (query: string) => void
  patchFilters: (patch: Partial<LibraryFilters>) => void
  setSort: (field: LibrarySortField, direction?: LibrarySortDirection) => void
  openGroup: (groupKey: string) => void
  clearGroup: () => void
  toggleSelected: (trackId: string) => void
  clearSelection: () => void
  selectAllVisible: (trackIds: string[]) => void
  setActionTrackId: (trackId: string | null) => void

  getVisibleEntries: (categories: Category[]) => LibraryEntry[]
  getGroups: (categories: Category[]) => LibraryGroup[]
  getVisibleSections: () => typeof LIBRARY_SECTIONS
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  catalog: [],
  isLoading: false,
  error: null,
  section: 'all',
  filters: { ...DEFAULT_LIBRARY_FILTERS },
  sortField: 'title',
  sortDirection: 'asc',
  selectedIds: [],
  actionTrackId: null,

  refresh: async () => {
    set({ isLoading: true, error: null })
    try {
      const catalog = await buildLibraryCatalog()
      set({ catalog, isLoading: false })
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Не удалось загрузить библиотеку',
      })
    }
  },

  setSection: (section) => {
    set({
      section,
      filters: { ...get().filters, groupKey: null },
      selectedIds: [],
    })
  },

  setQuery: (query) => {
    set({ filters: { ...get().filters, query } })
  },

  patchFilters: (patch) => {
    set({ filters: { ...get().filters, ...patch } })
  },

  setSort: (field, direction) => {
    const current = get()
    const nextDirection =
      direction ??
      (current.sortField === field && current.sortDirection === 'asc'
        ? 'desc'
        : 'asc')
    set({ sortField: field, sortDirection: nextDirection })
  },

  openGroup: (groupKey) => {
    set({ filters: { ...get().filters, groupKey }, selectedIds: [] })
  },

  clearGroup: () => {
    set({ filters: { ...get().filters, groupKey: null } })
  },

  toggleSelected: (trackId) => {
    const selected = get().selectedIds
    set({
      selectedIds: selected.includes(trackId)
        ? selected.filter((id) => id !== trackId)
        : [...selected, trackId],
    })
  },

  clearSelection: () => set({ selectedIds: [] }),

  selectAllVisible: (trackIds) => set({ selectedIds: [...trackIds] }),

  setActionTrackId: (trackId) => set({ actionTrackId: trackId }),

  getVisibleEntries: (categories) => {
    const state = get()
    return queryLibraryEntries(
      state.catalog,
      {
        section: state.section,
        filters: state.filters,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
      },
      categories,
    )
  },

  getGroups: (categories) => {
    const state = get()
    return buildLibraryGroups(
      state.catalog,
      state.section,
      categories,
      state.filters,
    )
  },

  getVisibleSections: () => {
    const catalog = get().catalog
    const hasFolders = sectionHasLocalFolders(catalog)
    return LIBRARY_SECTIONS.filter(
      (section) => !section.requiresLocalFiles || hasFolders,
    )
  },
}))

/** Хелпер для UI: категории из существующего store. */
export function getLibraryCategories(): Category[] {
  return useCollectionStore.getState().categories
}
