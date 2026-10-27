export type TasteTrackKey =
  | { kind: 'canonical'; canonicalTrackId: string }
  | { kind: 'source'; sourceId: string; externalId: string }

export type TasteSignalOrigin =
  | 'canonical-like'
  | 'canonical-dislike'
  | 'canonical-hidden'
  | 'canonical-skip-count'
  | 'history-like'
  | 'history-skip'
  | 'library-play-count'
  | 'playback-listen'
  | 'playback-completion'
  | 'playback-early-skip'

export type TasteSignalConfidence = 'explicit' | 'observed' | 'weak'

export type TasteSignal = {
  origin: TasteSignalOrigin
  confidence: TasteSignalConfidence
  weight: number
  note: string
}

export type TasteSourceCopy = {
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
}

export type TasteLibraryTrack = {
  canonicalTrackId: string
  title: string
  artist: string
  liked: boolean
  disliked: boolean
  hidden: boolean
  playCount: number
  skipped: number
  lastPlayed: string | null
  catalogIds: readonly string[]
  copies: readonly TasteSourceCopy[]
}

export type TasteCatalog = {
  id: string
  name: string
}

export type TastePlaybackStat = {
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  playCount: number
  completedCount: number
  skippedCount: number
  listenedMs: number
}

export type TastePlaybackEvent = {
  sessionId: string
  eventType: string
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  listenedMs: number
  durationMs: number | null
  reason: string | null
  createdAt: string
}

export type TasteHistoryEntry = {
  action: string
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  catalogId: string | null
  createdAt: string
}

export type TasteInput = {
  library: readonly TasteLibraryTrack[]
  catalogs: readonly TasteCatalog[]
  stats: readonly TastePlaybackStat[]
  events: readonly TastePlaybackEvent[]
  history: readonly TasteHistoryEntry[]
}

export type TasteActivityOrigin = 'playback-started' | 'playback-completed' | 'library-last-played' | 'history'

export type TasteActivity = {
  key: TasteTrackKey
  at: string
  origin: TasteActivityOrigin
}

/** Каталог пользователя. Имя — подпись человека, не жанр и не настроение. */
export type TasteCatalogMembership = {
  catalogId: string
  name: string
  trackKeys: TasteTrackKey[]
}

export type TasteTrackProfile = {
  key: TasteTrackKey
  label: { title: string; artist: string } | null
  copies: TasteSourceCopy[]
  score: number
  signals: TasteSignal[]
  lastPlayed: string | null
}

export type UserTasteProfile = {
  schemaVersion: 1
  userId: string
  builtAt: string
  empty: boolean
  tracks: TasteTrackProfile[]
  catalogs: TasteCatalogMembership[]
  recentActivity: TasteActivity[]
}
