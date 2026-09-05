import type { Track } from '../types/track'

/** Стабильный id трека в рамках приложения: source + внешний ключ. */
export function createTrackId(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`
}

export function createTrack(input: {
  sourceId: string
  externalId: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  durationMs?: number
  coverUrl?: string | null
  coverColor?: string
  previewUrl?: string | null
  tags?: string[]
}): Track {
  return {
    id: createTrackId(input.sourceId, input.externalId),
    sourceId: input.sourceId,
    externalId: input.externalId,
    title: input.title,
    artist: input.artist,
    album: input.album,
    genre: input.genre,
    year: input.year,
    durationMs: input.durationMs,
    coverUrl: input.coverUrl ?? null,
    coverColor: input.coverColor,
    previewUrl: input.previewUrl ?? null,
    tags: input.tags,
  }
}
