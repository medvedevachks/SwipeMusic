import type { IsoTimestamp } from '../types.ts'
import type { CanonicalTrackDto, SourceCopyDto } from '../identity/types.ts'

/**
 * Состояние композиции для пользователя.
 * Не хранит снимок провайдера и playback URL.
 */
export type CanonicalUserState = {
  addedAt: IsoTimestamp
  lastPlayed: IsoTimestamp | null
  playCount: number
  liked: boolean
  likedAt: IsoTimestamp | null
  disliked: boolean
  skipped: number
  notes: string
  favorite: boolean
  hidden: boolean
  customMetadata: Record<string, unknown>
}

export type CanonicalLibraryItem = {
  canonicalTrack: CanonicalTrackDto
  copies: SourceCopyDto[]
  state: CanonicalUserState
  catalogIds: string[]
}

export type CanonicalMembership = {
  catalogId: string
  canonicalTrackId: string
  createdAt: IsoTimestamp
}
