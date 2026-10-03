import type { IsoTimestamp } from '../types.ts'

/**
 * Внутренняя композиция Swipe Music.
 * Не принадлежит провайдеру и не хранит playback URL.
 */
export type CanonicalTrackDto = {
  id: string
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  artworkUrl: string | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

/**
 * Копия композиции в одном источнике.
 * `sourceTrackKey` — прежний `Track.id`: `${sourceId}:${externalId}`.
 */
export type SourceCopyDto = {
  sourceTrackKey: string
  canonicalTrackId: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album: string | null
  durationMs: number | null
  artworkUrl: string | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export type TrackIdentityDto = {
  canonicalTrack: CanonicalTrackDto
  copies: SourceCopyDto[]
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
