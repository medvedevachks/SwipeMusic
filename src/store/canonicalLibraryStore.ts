import { create } from 'zustand'
import { mapCanonicalItem, mergeIdentityIntoItem } from '../services/canonical/mapCanonical.ts'
import type { CanonicalLibraryItem, TrackIdentity } from '../types/canonical.ts'

export type CanonicalLibraryStatus = 'idle' | 'loading' | 'ready' | 'error'

type CanonicalLibraryStore = {
  userId: string | null
  itemsById: Record<string, CanonicalLibraryItem>
  sourceKeyToCanonicalId: Record<string, string>
  status: CanonicalLibraryStatus
  error: string | null
  replaceForUser: (userId: string, items: readonly CanonicalLibraryItem[]) => void
  clear: () => void
  beginLoad: () => void
  upsertItem: (item: CanonicalLibraryItem) => void
  absorbIdentity: (identity: TrackIdentity) => CanonicalLibraryItem
  addCatalog: (canonicalTrackId: string, catalogId: string) => void
  removeCatalog: (canonicalTrackId: string, catalogId: string) => void
  dropCatalog: (catalogId: string) => void
}

const empty = {
  userId: null as string | null,
  itemsById: {} as Record<string, CanonicalLibraryItem>,
  sourceKeyToCanonicalId: {} as Record<string, string>,
  status: 'idle' as CanonicalLibraryStatus,
  error: null as string | null,
}

function indexItem(
  sourceKeyToCanonicalId: Record<string, string>,
  item: CanonicalLibraryItem,
): Record<string, string> {
  const next = { ...sourceKeyToCanonicalId }
  for (const [key, canonicalId] of Object.entries(next)) {
    if (canonicalId === item.canonicalTrack.id) {
      delete next[key]
    }
  }
  for (const copy of item.copies) {
    next[copy.sourceTrackKey] = item.canonicalTrack.id
  }
  return next
}

export const useCanonicalLibraryStore = create<CanonicalLibraryStore>((set, get) => ({
  ...empty,

  replaceForUser: (userId, items) => {
    const itemsById: Record<string, CanonicalLibraryItem> = {}
    let sourceKeyToCanonicalId: Record<string, string> = {}
    for (const raw of items) {
      const item = mapCanonicalItem(raw)
      itemsById[item.canonicalTrack.id] = item
      sourceKeyToCanonicalId = indexItem(sourceKeyToCanonicalId, item)
    }
    set({
      userId,
      itemsById,
      sourceKeyToCanonicalId,
      status: 'ready',
      error: null,
    })
  },

  clear: () => set({ ...empty }),

  beginLoad: () => set({ status: 'loading', error: null }),

  upsertItem: (raw) => {
    const item = mapCanonicalItem(raw)
    set((state) => ({
      itemsById: { ...state.itemsById, [item.canonicalTrack.id]: item },
      sourceKeyToCanonicalId: indexItem(state.sourceKeyToCanonicalId, item),
      status: state.status === 'idle' ? 'ready' : state.status,
      error: null,
    }))
  },

  absorbIdentity: (identity) => {
    const current = get().itemsById[identity.canonicalTrack.id] ?? null
    const item = mergeIdentityIntoItem(current, identity)
    set((state) => ({
      itemsById: { ...state.itemsById, [item.canonicalTrack.id]: item },
      sourceKeyToCanonicalId: indexItem(state.sourceKeyToCanonicalId, item),
      status: state.status === 'idle' ? 'ready' : state.status,
    }))
    return item
  },

  addCatalog: (canonicalTrackId, catalogId) => {
    const item = get().itemsById[canonicalTrackId]
    if (!item || item.catalogIds.includes(catalogId)) {
      return
    }
    const next: CanonicalLibraryItem = {
      ...item,
      catalogIds: [...item.catalogIds, catalogId],
    }
    set((state) => ({
      itemsById: { ...state.itemsById, [canonicalTrackId]: next },
    }))
  },

  removeCatalog: (canonicalTrackId, catalogId) => {
    const item = get().itemsById[canonicalTrackId]
    if (!item) {
      return
    }
    set((state) => ({
      itemsById: {
        ...state.itemsById,
        [canonicalTrackId]: {
          ...item,
          catalogIds: item.catalogIds.filter((id) => id !== catalogId),
        },
      },
    }))
  },

  dropCatalog: (catalogId) => {
    set((state) => {
      const itemsById: Record<string, CanonicalLibraryItem> = {}
      for (const [id, item] of Object.entries(state.itemsById)) {
        itemsById[id] = {
          ...item,
          catalogIds: item.catalogIds.filter((current) => current !== catalogId),
        }
      }
      return { itemsById }
    })
  },
}))
