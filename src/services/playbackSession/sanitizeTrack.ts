import type { Track } from '../../types/track.ts'

/**
 * Копия трека без временных URL / секретов источников.
 * coverUrl оставляем как метаданные обложки (не stream).
 */
export function sanitizeSessionTrack(track: Track): Track {
  return {
    id: track.id,
    sourceId: track.sourceId,
    externalId: track.externalId,
    title: track.title,
    artist: track.artist,
    ...(track.album !== undefined ? { album: track.album } : {}),
    ...(track.genre !== undefined ? { genre: track.genre } : {}),
    ...(track.year !== undefined ? { year: track.year } : {}),
    ...(track.durationMs !== undefined ? { durationMs: track.durationMs } : {}),
    ...(track.coverUrl !== undefined ? { coverUrl: track.coverUrl } : {}),
    ...(track.coverColor !== undefined ? { coverColor: track.coverColor } : {}),
    previewUrl: null,
    ...(track.tags !== undefined ? { tags: [...track.tags] } : {}),
  }
}

export function sanitizeSessionTracks(tracks: readonly Track[]): Track[] {
  return tracks.map(sanitizeSessionTrack)
}
