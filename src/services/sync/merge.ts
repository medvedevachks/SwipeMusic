import type { Category, LikedTrack, TrackAssignment } from '../../types/category'
import type { GestureConfig } from '../../types/gesture'
import type { TrackDecision } from '../../types/history'
import type {
  CategoryDto,
  CollectionItemDto,
  CollectionSnapshot,
  TrackDecisionDto,
} from '../../types/sync'

export function splitTrackId(trackId: string): { sourceId: string; externalId: string } {
  const index = trackId.indexOf(':')
  if (index <= 0) {
    return { sourceId: 'unknown', externalId: trackId }
  }
  return {
    sourceId: trackId.slice(0, index),
    externalId: trackId.slice(index + 1),
  }
}

export function snapshotFromStore(input: {
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  viewedTrackIds: string[]
  gestureConfig: GestureConfig
  decisions: TrackDecision[]
}): CollectionSnapshot {
  const now = new Date().toISOString()
  const items: CollectionItemDto[] = [
    ...input.likedTracks.map((item) => {
      const identity = splitTrackId(item.trackId)
      return {
        id: item.id,
        kind: 'like' as const,
        trackId: item.trackId,
        sourceId: identity.sourceId,
        externalId: identity.externalId,
        categoryId: null,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
      }
    }),
    ...input.assignments.map((item) => {
      const identity = splitTrackId(item.trackId)
      return {
        id: item.id,
        kind: 'assignment' as const,
        trackId: item.trackId,
        sourceId: identity.sourceId,
        externalId: identity.externalId,
        categoryId: item.categoryId,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
      }
    }),
  ]

  const decisions: TrackDecisionDto[] = input.decisions.map((item) => {
    const identity = splitTrackId(item.trackId)
    return {
      id: item.id,
      trackId: item.trackId,
      sourceId: identity.sourceId,
      externalId: identity.externalId,
      action: item.action,
      createdAt: item.createdAt,
    }
  })

  return {
    categories: input.categories.map((category) => ({
      ...category,
      updatedAt: category.createdAt,
    })),
    items,
    decisions,
    settings: {
      gestureConfig: input.gestureConfig,
      viewedTrackIds: input.viewedTrackIds,
      updatedAt: now,
    },
  }
}

export function storeFromSnapshot(snapshot: CollectionSnapshot): {
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  viewedTrackIds: string[]
  gestureConfig: GestureConfig
  decisions: TrackDecision[]
} {
  const liveCategories = snapshot.categories.filter((item) => !item.deletedAt)
  const liveItems = snapshot.items.filter((item) => !item.deletedAt)

  return {
    categories: liveCategories.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      icon: item.icon as Category['icon'],
      createdAt: item.createdAt,
    })),
    assignments: liveItems
      .filter((item) => item.kind === 'assignment' && item.categoryId)
      .map((item) => ({
        id: item.id,
        trackId: item.trackId,
        categoryId: item.categoryId as string,
        createdAt: item.createdAt,
      })),
    likedTracks: liveItems
      .filter((item) => item.kind === 'like')
      .map((item) => ({
        id: item.id,
        trackId: item.trackId,
        createdAt: item.createdAt,
      })),
    viewedTrackIds: snapshot.settings?.viewedTrackIds ?? [],
    gestureConfig: snapshot.settings?.gestureConfig ?? {
      right: 'categorize',
      left: 'like',
      up: 'skip',
      down: 'previous',
    },
    decisions: snapshot.decisions.map((item) => ({
      id: item.id,
      trackId: item.trackId,
      action: item.action,
      createdAt: item.createdAt,
    })),
  }
}

export function mergeSnapshots(
  local: CollectionSnapshot,
  remote: CollectionSnapshot,
): CollectionSnapshot {
  const categories = new Map<string, CategoryDto>()
  for (const item of [...remote.categories, ...local.categories]) {
    const current = categories.get(item.id)
    if (!current || Date.parse(item.updatedAt) >= Date.parse(current.updatedAt)) {
      categories.set(item.id, item)
    }
  }

  const items = new Map<string, CollectionItemDto>()
  for (const item of [...remote.items, ...local.items]) {
    const current = items.get(item.id)
    if (!current || Date.parse(item.updatedAt) >= Date.parse(current.updatedAt)) {
      items.set(item.id, item)
    }
  }

  const decisions = new Map<string, TrackDecisionDto>()
  for (const item of [...remote.decisions, ...local.decisions]) {
    decisions.set(item.id, item)
  }

  const settings =
    local.settings && remote.settings
      ? Date.parse(local.settings.updatedAt) >= Date.parse(remote.settings.updatedAt)
        ? local.settings
        : remote.settings
      : (local.settings ?? remote.settings)

  return {
    categories: [...categories.values()],
    items: [...items.values()],
    decisions: [...decisions.values()],
    settings,
  }
}

export function hasUserCollectionData(snapshot: CollectionSnapshot): boolean {
  const liveItems = snapshot.items.filter((item) => !item.deletedAt)
  const liveCategories = snapshot.categories.filter((item) => !item.deletedAt)
  return liveItems.length > 0 || liveCategories.length > 0 || snapshot.decisions.length > 0
}

export function snapshotIsEmpty(snapshot: CollectionSnapshot): boolean {
  return (
    snapshot.categories.filter((item) => !item.deletedAt).length === 0 &&
    snapshot.items.filter((item) => !item.deletedAt).length === 0 &&
    snapshot.decisions.length === 0
  )
}

export function operationsFromSnapshot(snapshot: CollectionSnapshot) {
  const now = new Date().toISOString()
  const ops: import('../../types/sync').SyncOperation[] = []

  for (const category of snapshot.categories) {
    ops.push({
      id: `op_${category.id}_cat`,
      type: category.deletedAt ? 'delete_category' : 'upsert_category',
      payload: category,
      clientCreatedAt: now,
    })
  }
  for (const item of snapshot.items) {
    ops.push({
      id: `op_${item.id}_item`,
      type: item.deletedAt ? 'delete_item' : 'upsert_item',
      payload: item,
      clientCreatedAt: now,
    })
  }
  for (const decision of snapshot.decisions) {
    ops.push({
      id: `op_${decision.id}_dec`,
      type: 'append_decision',
      payload: decision,
      clientCreatedAt: now,
    })
  }
  if (snapshot.settings) {
    ops.push({
      id: `op_settings_${snapshot.settings.updatedAt}`,
      type: 'upsert_settings',
      payload: snapshot.settings,
      clientCreatedAt: now,
    })
  }
  return ops
}
