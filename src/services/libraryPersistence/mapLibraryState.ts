import { defaultGestureConfig } from '../../config/gestureConfig.ts'
import type { Category, LikedTrack, TrackAssignment } from '../../types/category'
import type { CollectionTrackData } from '../../types/collectionUser'
import type { GestureConfig } from '../../types/gesture'
import type { HistoryEntry } from '../../types/history'
import type { SwipeAction } from '../../types/swipe'
import type { Track } from '../../types/track'

export type LibraryStateDto = {
  /** Каталоги. Ключ `categories` — совместимое имя ответа `/api/me/library-state`. */
  categories: Category[]
  tracks: CollectionTrackDto[]
  categoryAssignments: TrackAssignment[]
  history: HistoryEntry[]
  settings?: {
    gestureConfig?: Partial<GestureConfig>
  }
}

export type CollectionTrackDto = {
  trackId: string
  sourceId: string
  track: Track
  addedAt: string
  lastPlayed: string | null
  playCount: number
  liked: boolean
  likedAt: string | null
  disliked: boolean
  skipped: number
  categories: string[]
  notes: string
  favorite: boolean
  hidden: boolean
  customMetadata: Record<string, unknown>
}

export type HydratedUserLibrary = {
  categories: Category[]
  assignments: TrackAssignment[]
  likedTracks: LikedTrack[]
  history: HistoryEntry[]
  gestureConfig: GestureConfig
  tracks: CollectionTrackData[]
}

const SWIPE_ACTIONS = new Set<SwipeAction>(['categorize', 'like', 'skip', 'previous'])

export function mapLibraryState(dto: LibraryStateDto): HydratedUserLibrary {
  const categories = dto.categories.map(copyCategory)
  const assignments = dto.categoryAssignments.map((item) => ({
    id: item.id,
    trackId: item.trackId,
    categoryId: item.categoryId,
    createdAt: item.createdAt,
  }))
  const tracks = dto.tracks.map(toCollectionTrack)
  return {
    categories,
    assignments,
    likedTracks: tracks
      .filter((track) => track.liked)
      .map((track) => ({
        trackId: track.trackId,
        createdAt:
          dto.tracks.find((item) => item.trackId === track.trackId)?.likedAt ??
          track.addedAt,
      })),
    history: dto.history.map(copyHistory),
    gestureConfig: normalizeGesture(dto.settings?.gestureConfig),
    tracks,
  }
}

export function toCollectionTrack(dto: CollectionTrackDto): CollectionTrackData {
  return {
    trackId: dto.trackId,
    sourceId: dto.sourceId,
    track: copyTrack(dto.track),
    addedAt: dto.addedAt,
    lastPlayed: dto.lastPlayed,
    playCount: dto.playCount,
    liked: dto.liked,
    disliked: dto.disliked,
    skipped: dto.skipped,
    categories: [...dto.categories],
    notes: dto.notes,
    favorite: dto.favorite,
    hidden: dto.hidden,
    customMetadata: stripSecrets(dto.customMetadata),
  }
}

export function copyTrack(track: Track): Track {
  const next: Track = {
    id: track.id,
    sourceId: track.sourceId,
    externalId: track.externalId,
    title: track.title,
    artist: track.artist,
  }
  if (track.album) next.album = track.album
  if (track.genre) next.genre = track.genre
  if (track.year != null) next.year = track.year
  if (track.durationMs != null) next.durationMs = track.durationMs
  if (track.coverUrl) next.coverUrl = track.coverUrl
  if (track.coverColor) next.coverColor = track.coverColor
  if (track.previewUrl) next.previewUrl = track.previewUrl
  if (track.tags && track.tags.length > 0) next.tags = [...track.tags]
  return next
}

export function copyCategory(category: Category): Category {
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    description: category.description,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    sortOrder: category.sortOrder,
    favorite: category.favorite,
    system: category.system,
  }
}

function copyHistory(entry: HistoryEntry): HistoryEntry {
  const next: HistoryEntry = {
    id: entry.id,
    track: copyTrack(entry.track),
    action: entry.action,
    createdAt: entry.createdAt,
    sourceId: entry.sourceId,
  }
  if (entry.category) {
    next.category = copyCategory(entry.category)
  }
  return next
}

export function normalizeGesture(value: Partial<GestureConfig> | undefined): GestureConfig {
  const next: GestureConfig = { ...defaultGestureConfig }
  if (!value) {
    return next
  }
  for (const direction of ['left', 'right', 'up', 'down'] as const) {
    const action = value[direction]
    if (action && SWIPE_ACTIONS.has(action)) {
      next[direction] = action
    }
  }
  return next
}

const SECRET_KEY = /token|secret|password|credential|oauth/i

export function stripSecrets(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || key === 'session' || key === 'authorization') {
      continue
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      next[key] = stripSecrets(nested as Record<string, unknown>)
    } else {
      next[key] = nested
    }
  }
  return next
}

export function toTrackUpsertBody(
  record: CollectionTrackData,
  likedAt: string | null,
  options: { includeUserFields: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sourceId: record.track.sourceId,
    externalId: record.track.externalId,
    title: record.track.title,
    artist: record.track.artist,
  }
  if (record.track.album) body.album = record.track.album
  if (record.track.genre) body.genre = record.track.genre
  if (record.track.year != null) body.year = record.track.year
  if (record.track.durationMs != null) body.durationMs = record.track.durationMs
  if (record.track.coverUrl) body.coverUrl = record.track.coverUrl
  if (record.track.coverColor) body.coverColor = record.track.coverColor
  if (record.track.previewUrl) body.previewUrl = record.track.previewUrl
  if (record.track.tags && record.track.tags.length > 0) body.tags = record.track.tags
  if (options.includeUserFields) {
    body.addedAt = record.addedAt
    body.lastPlayed = record.lastPlayed
    body.playCount = record.playCount
    body.liked = record.liked
    body.likedAt = record.liked ? likedAt : null
    body.disliked = record.disliked
    body.skipped = record.skipped
    body.notes = record.notes
    body.favorite = record.favorite
    body.hidden = record.hidden
    body.customMetadata = stripSecrets(record.customMetadata)
  }
  return body
}

export function trackFromDomain(track: Track): CollectionTrackData {
  return {
    trackId: track.id,
    sourceId: track.sourceId,
    track: copyTrack(track),
    addedAt: new Date().toISOString(),
    lastPlayed: null,
    playCount: 0,
    liked: false,
    disliked: false,
    skipped: 0,
    categories: [],
    notes: '',
    favorite: false,
    hidden: false,
    customMetadata: {},
  }
}
