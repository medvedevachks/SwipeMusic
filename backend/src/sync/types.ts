export type GestureConfigDto = {
  right: 'categorize' | 'like' | 'skip' | 'previous'
  left: 'categorize' | 'like' | 'skip' | 'previous'
  up: 'categorize' | 'like' | 'skip' | 'previous'
  down: 'categorize' | 'like' | 'skip' | 'previous'
}

export type CategoryDto = {
  id: string
  name: string
  color: string
  icon: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type CollectionItemDto = {
  id: string
  kind: 'like' | 'assignment' | 'source_track'
  trackId: string
  sourceId: string
  externalId: string
  categoryId?: string | null
  title?: string | null
  artist?: string | null
  pageUrl?: string | null
  durationMs?: number | null
  availability?: 'available' | 'unavailable' | 'unknown' | null
  playbackMode?: 'none' | 'external' | 'embedded' | null
  position?: number | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type TrackDecisionDto = {
  id: string
  trackId: string
  sourceId: string
  externalId: string
  action: 'like' | 'skip' | 'categorize'
  createdAt: string
}

export type UserSettingsDto = {
  gestureConfig: GestureConfigDto
  viewedTrackIds: string[]
  updatedAt: string
}

export type CollectionSnapshot = {
  categories: CategoryDto[]
  items: CollectionItemDto[]
  decisions: TrackDecisionDto[]
  settings: UserSettingsDto | null
}

export type SyncOperationType =
  | 'upsert_category'
  | 'delete_category'
  | 'upsert_item'
  | 'delete_item'
  | 'append_decision'
  | 'upsert_settings'

export type SyncOperation = {
  id: string
  type: SyncOperationType
  payload: unknown
  clientCreatedAt: string
}

export type SyncStatus = 'local' | 'syncing' | 'cloud' | 'error'
