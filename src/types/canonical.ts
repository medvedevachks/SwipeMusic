/**
 * Frontend DTO канонической библиотеки.
 * Поля совпадают с server/library/identity/types.ts и server/library/canonical/types.ts.
 * Это не вторая модель и не playback identity.
 */

export type CanonicalTrack = {
  id: string
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  artworkUrl: string | null
  createdAt: string
  updatedAt: string
}

export type SourceCopy = {
  sourceTrackKey: string
  canonicalTrackId: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  artworkUrl: string | null
  createdAt: string
  updatedAt: string
}

export type CanonicalUserState = {
  addedAt: string
  lastPlayed: string | null
  playCount: number
  liked: boolean
  likedAt: string | null
  disliked: boolean
  skipped: number
  notes: string
  favorite: boolean
  hidden: boolean
  customMetadata: Record<string, unknown>
}

export type CanonicalLibraryItem = {
  canonicalTrack: CanonicalTrack
  copies: SourceCopy[]
  state: CanonicalUserState
  catalogIds: string[]
}

export type CanonicalMembership = {
  catalogId: string
  canonicalTrackId: string
  createdAt: string
}

export type TrackIdentity = {
  canonicalTrack: CanonicalTrack
  copies: SourceCopy[]
}

export type SourceCopySnapshot = {
  sourceId: string
  externalId: string
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  artworkUrl: string | null
}
