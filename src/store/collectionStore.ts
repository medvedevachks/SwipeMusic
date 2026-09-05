import { create } from 'zustand'
import { defaultGestureConfig } from '../config/gestureConfig'
import { createDefaultCategories } from '../services/defaultCategories'
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
import { createId } from '../utils/id'

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
}

const initialCollectionId = createId('col')
const initialCreatedAt = new Date().toISOString()

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collectionId: initialCollectionId,
  collectionName: 'Моя коллекция',
  categories: createDefaultCategories(),
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
  },

  deleteCategory: (id) => {
    const target = get().categories.find((category) => category.id === id)
    if (target?.system) {
      return
    }

    set((state) => ({
      categories: state.categories.filter((category) => category.id !== id),
      assignments: state.assignments.filter(
        (assignment) => assignment.categoryId !== id,
      ),
    }))
  },

  assignTrackToCategory: (trackId, categoryId) => {
    const assignment: TrackAssignment = {
      id: createId('asg'),
      trackId,
      categoryId,
      createdAt: new Date().toISOString(),
    }

    set((state) => ({
      assignments: [
        ...state.assignments.filter(
          (item) =>
            !(item.trackId === trackId && item.categoryId === categoryId),
        ),
        assignment,
      ],
    }))
  },

  likeTrack: (trackId) => {
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

  unlikeTrack: (trackId) => {
    set((state) => ({
      likedTracks: state.likedTracks.filter((item) => item.trackId !== trackId),
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

    return entry
  },

  setGestureConfig: (config) => {
    set({ gestureConfig: config })
  },
}))
