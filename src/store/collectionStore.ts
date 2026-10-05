import { create } from 'zustand'
import { defaultGestureConfig } from '../config/gestureConfig.ts'
import { getCollectionEngine } from '../services/collectionEngine/index.ts'
import { useCanonicalLibraryStore } from './canonicalLibraryStore.ts'
import {
  persistCategory,
  persistCategoryDelete,
  persistGesture,
  persistHistory,
} from '../services/libraryPersistence/mutations.ts'
import type {
  Category,
  CategoryIconId,
  LikedTrack,
  TrackAssignment,
} from '../types/category'
import type { Collection } from '../types/collection'
import type { GestureConfig } from '../types/gesture'
import type { HistoryEntry } from '../types/history'
import type { SwipeAction } from '../types/swipe'
import type { Track } from '../types/track'
import { createId } from '../utils/id.ts'

type CreateCategoryInput = {
  name: string
  color: string
  icon: CategoryIconId
  description?: string
  favorite?: boolean
}

type UpdateCategoryInput = Partial<
  Pick<
    Category,
    'name' | 'color' | 'icon' | 'description' | 'sortOrder' | 'favorite'
  >
>

type RecordHistoryInput = {
  track: Track
  action: SwipeAction
  category?: Category
  sourceId?: string
}

type CollectionState = {
  collectionId: string
  collectionName: string
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  viewedTrackIds: string[]
  history: HistoryEntry[]
  gestureConfig: GestureConfig

  getCollection: () => Collection

  createCategory: (input: CreateCategoryInput) => Category
  updateCategory: (id: string, input: UpdateCategoryInput) => void
  deleteCategory: (id: string) => void

  assignTrackToCategory: (trackId: string, categoryId: string) => void
  likeTrack: (trackId: string) => void
  unlikeTrack: (trackId: string) => void

  pushViewedTrack: (trackId: string) => void
  recordHistory: (input: RecordHistoryInput) => HistoryEntry
  setGestureConfig: (config: GestureConfig) => void
  ensureAssignment: (trackId: string, categoryId: string) => TrackAssignment
  removeAssignment: (trackId: string, categoryId: string) => void
  mirrorLike: (trackId: string, liked: boolean) => void
  applyServerState: (input: {
    categories: Category[]
    assignments: TrackAssignment[]
    likedTracks: LikedTrack[]
    history: HistoryEntry[]
    gestureConfig: GestureConfig
  }) => void
  clearUserLibrary: () => void
}

const initialCollectionId = createId('col')
const initialCreatedAt = new Date().toISOString()

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collectionId: initialCollectionId,
  collectionName: 'Моя коллекция',
  categories: [],
  assignments: [],
  likedTracks: [],
  viewedTrackIds: [],
  history: [],
  gestureConfig: defaultGestureConfig,

  getCollection: () => {
    const state = get()
    return {
      id: state.collectionId,
      name: state.collectionName,
      categories: state.categories,
      assignments: state.assignments,
      likedTracks: state.likedTracks,
      createdAt: initialCreatedAt,
      updatedAt: new Date().toISOString(),
    }
  },

  createCategory: (input) => {
    const now = new Date().toISOString()
    const category: Category = {
      id: createId('cat'),
      name: input.name.trim(),
      color: input.color,
      icon: input.icon,
      description: input.description?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
      sortOrder: get().categories.length,
      favorite: input.favorite ?? false,
      system: false,
    }

    set((state) => ({
      categories: [...state.categories, category],
    }))
    persistCategory(category, 'create')

    return category
  },

  updateCategory: (id, input) => {
    const now = new Date().toISOString()
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === id
          ? {
              ...category,
              ...input,
              name: input.name?.trim() || category.name,
              description:
                input.description !== undefined
                  ? input.description.trim()
                  : category.description,
              updatedAt: now,
            }
          : category,
      ),
    }))
    const updated = get().categories.find((category) => category.id === id)
    if (updated) {
      persistCategory(updated, 'update')
    }
  },

  deleteCategory: (id) => {
    const target = get().categories.find((category) => category.id === id)
    if (!target || target.system) {
      return
    }

    const trackIds = get()
      .assignments.filter((assignment) => assignment.categoryId === id)
      .map((assignment) => assignment.trackId)

    set((state) => ({
      categories: state.categories.filter((category) => category.id !== id),
      assignments: state.assignments.filter(
        (assignment) => assignment.categoryId !== id,
      ),
    }))
    const engine = getCollectionEngine()
    for (const trackId of trackIds) {
      engine.removeCategory(trackId, id)
    }
    useCanonicalLibraryStore.getState().dropCatalog(id)
    persistCategoryDelete(id)
  },

  assignTrackToCategory: (trackId, categoryId) => {
    get().ensureAssignment(trackId, categoryId)
  },

  ensureAssignment: (trackId, categoryId) => {
    const existing = get().assignments.find(
      (item) => item.trackId === trackId && item.categoryId === categoryId,
    )
    if (existing) {
      return existing
    }
    const assignment: TrackAssignment = {
      id: createId('asg'),
      trackId,
      categoryId,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      assignments: [...state.assignments, assignment],
    }))
    return assignment
  },

  removeAssignment: (trackId, categoryId) => {
    set((state) => ({
      assignments: state.assignments.filter(
        (item) => !(item.trackId === trackId && item.categoryId === categoryId),
      ),
    }))
  },

  likeTrack: (trackId) => {
    get().mirrorLike(trackId, true)
  },

  unlikeTrack: (trackId) => {
    get().mirrorLike(trackId, false)
  },

  mirrorLike: (trackId, liked) => {
    if (!liked) {
      set((state) => ({
        likedTracks: state.likedTracks.filter((item) => item.trackId !== trackId),
      }))
      return
    }
    if (get().likedTracks.some((item) => item.trackId === trackId)) {
      return
    }
    set((state) => ({
      likedTracks: [
        ...state.likedTracks,
        { trackId, createdAt: new Date().toISOString() },
      ],
    }))
  },

  pushViewedTrack: (trackId) => {
    set((state) => {
      if (state.viewedTrackIds[state.viewedTrackIds.length - 1] === trackId) {
        return state
      }

      return {
        viewedTrackIds: [...state.viewedTrackIds, trackId],
      }
    })
  },

  recordHistory: (input) => {
    const entry: HistoryEntry = {
      id: createId('hist'),
      track: input.track,
      action: input.action,
      category: input.category,
      createdAt: new Date().toISOString(),
      sourceId: input.sourceId ?? input.track.sourceId,
    }

    set((state) => ({
      history: [...state.history, entry],
    }))
    persistHistory(entry)

    return entry
  },

  setGestureConfig: (config) => {
    set({ gestureConfig: config })
    persistGesture(config)
  },

  applyServerState: (input) => {
    set({
      categories: input.categories,
      assignments: input.assignments,
      likedTracks: input.likedTracks,
      history: input.history,
      gestureConfig: input.gestureConfig,
    })
  },

  clearUserLibrary: () => {
    set({
      categories: [],
      assignments: [],
      likedTracks: [],
      viewedTrackIds: [],
      history: [],
      gestureConfig: defaultGestureConfig,
    })
  },
}))
