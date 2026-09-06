import type { Track } from '../../types/track'

/** Обнаруженный медиа-объект до извлечения метаданных. */
export type MediaFile = {
  sourceId: string
  externalId: string
  /** Относительный путь / URI без blob: */
  path?: string
  fileName?: string
  size?: number
  modifiedAt?: string
  mimeType?: string
}

export type TrackMetadata = {
  title: string
  artist: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  disc?: number
  trackNumber?: number
  durationMs?: number
  bitrate?: number
  sampleRate?: number
  codec?: string
  size?: number
  artworkKey?: string | null
  lyrics?: string | null
  isrc?: string | null
  musicBrainzId?: string | null
  tags?: string[]
}

/** Экземпляр одного логического трека в конкретном источнике. */
export type TrackCopy = {
  sourceId: string
  providerId: string
  externalId: string
  path?: string
  hash?: string
  available: boolean
  lastSynced: string
}

/**
 * Запись индекса. Не содержит ObjectURL / DOM.
 * `track` — канонический snapshot для UI / Queue / Swipe.
 */
export type TrackRecord = {
  id: string
  track: Track
  metadata: TrackMetadata
  sourceId: string
  providerId: string
  path?: string
  hash?: string
  indexedAt: string
  modifiedAt: string
  lastSynced: string
  copies: TrackCopy[]
  unavailable?: boolean
}

export type MediaIndexQuery = {
  sourceId?: string
  artist?: string
  album?: string
  folder?: string
  categoryId?: string
  q?: string
  includeUnavailable?: boolean
}

export type MediaIndexStats = {
  trackCount: number
  sourceCounts: Record<string, number>
  artistCount: number
  albumCount: number
  lastSyncedAt: string | null
}

export type MediaScanProgress = {
  sourceId: string
  phase: 'idle' | 'scanning' | 'extracting' | 'indexing' | 'done' | 'error'
  processed: number
  total: number
  message?: string
}
