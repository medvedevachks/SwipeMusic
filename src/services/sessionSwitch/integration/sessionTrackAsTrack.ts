import type { SessionTrack } from '../../playbackSession/types.ts'
import type { Track } from '../../../types/track.ts'

/** SessionTrack → Track для resolver / physical commit (без stream URL). */
export function sessionTrackAsTrack(track: SessionTrack): Track {
  return {
    id: track.id,
    sourceId: track.sourceId,
    externalId: track.externalId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    year: track.year,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
    coverColor: track.coverColor,
    tags: track.tags,
    previewUrl: null,
  }
}
