import { create } from 'zustand'
import { defaultGestureConfig } from '../config/gestureConfig'
import { createDefaultCategories } from '../services/defaultCategories'
import type {
  Category,
  CategoryIconId,
  LikedTrack,
  TrackAssignment,
} from '../types/category'
import type { GestureConfig } from '../types/gesture'
import type { TrackDecision } from '../types/history'
import { createId } from '../utils/id'

type CreateCategoryInput = {
  name: string
  color: string
  icon: CategoryIconId
}

type UpdateCategoryInput = Partial<Pick<Category, 'name' | 'color' | 'icon'>>

type CollectionState = {
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  viewedTrackIds: string[]
  decisions: TrackDecision[]
  gestureConfig: GestureConfig
  hydrated: boolean

  hydrate: (input: Partial<CollectionState>) => void
  createCategory: (input: CreateCategoryInput) => Category
  updateCategory: (id: string, input: UpdateCategoryInput) => void
  deleteCategory: (id: string) => void

  assignTrackToCategory: (trackId: string, categoryId: string) => void
  likeTrack: (trackId: string) => void
  unlikeTrack: (trackId: string) => void

  pushViewedTrack: (trackId: string) => void
  recordDecision: (trackId: string, action: TrackDecision['action']) => void
  setGestureConfig: (config: GestureConfig) => void
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  categories: createDefaultCategories(),
  assignments: [],
  likedTracks: [],
  viewedTrackIds: [],
  decisions: [],
  gestureConfig: defaultGestureConfig,
  hydrated: false,

  hydrate: (input) => {
    set({
      ...input,
      hydrated: true,
    })
  },

  createCategory: (input) => {
    const category: Category = {
      id: createId('cat'),
      name: input.name.trim(),
      color: input.color,
      icon: input.icon,
      createdAt: new Date().toISOString(),
    }

    set((state) => ({
      categories: [...state.categories, category],
    }))

    return category
  },

  updateCategory: (id, input) => {
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === id
          ? {
              ...category,
              ...input,
              name: input.name?.trim() || category.name,
            }
          : category,
      ),
    }))
  },

  deleteCategory: (id) => {
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
        {
          id: createId('like'),
          trackId,
          createdAt: new Date().toISOString(),
        },
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

  recordDecision: (trackId, action) => {
    set((state) => ({
      decisions: [
        ...state.decisions,
        {
          id: createId('dec'),
          trackId,
          action,
          createdAt: new Date().toISOString(),
        },
      ],
    }))
  },

  setGestureConfig: (config) => {
    set({ gestureConfig: config })
  },
}))
