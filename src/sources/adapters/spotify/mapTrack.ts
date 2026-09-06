import { createTrack } from '../../normalizeTrack'
import type { Track } from '../../../types/track'
import type { SpotifyTrack } from './types'

const SOURCE_ID = 'spotify'
const COVER_COLOR = '#1DB954'

export function mapSpotifyTrackToTrack(
  spotifyTrack: SpotifyTrack,
  tags?: string[],
): Track {
  const artist =
    spotifyTrack.artists.map((item) => item.name).filter(Boolean).join(', ') ||
    'Unknown Artist'
  const coverUrl = spotifyTrack.album.images?.[0]?.url ?? null
  const year = spotifyTrack.album.release_date
    ? Number.parseInt(spotifyTrack.album.release_date.slice(0, 4), 10)
    : undefined

  return createTrack({
    sourceId: SOURCE_ID,
    externalId: spotifyTrack.id,
    title: spotifyTrack.name,
    artist,
    album: spotifyTrack.album.name,
    year: Number.isFinite(year) ? year : undefined,
    durationMs: spotifyTrack.duration_ms,
    coverUrl,
    coverColor: COVER_COLOR,
    previewUrl: spotifyTrack.preview_url,
    tags,
  })
}
