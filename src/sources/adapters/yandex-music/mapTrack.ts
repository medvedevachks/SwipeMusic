import { createTrack } from '../../normalizeTrack'
import { withSearchPlayabilityTags } from '../../../services/searchEngine/searchPlayability.ts'
import type { Track } from '../../../types/track'
import type { YandexTrack } from './types'

const SOURCE_ID = 'yandex-music'
const COVER_COLOR = '#FC3F1D'

export function buildYandexCoverUrl(
  coverUri?: string | null,
  size = '200x200',
): string | null {
  if (!coverUri) {
    return null
  }
  const path = coverUri.replace('%%', size)
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  return `https://${path}`
}

export function mapYandexTrackToTrack(
  track: YandexTrack,
  tags?: string[],
): Track {
  const artist =
    track.artists?.map((item) => item.name).filter(Boolean).join(', ') ||
    'Unknown Artist'
  const album = track.albums?.[0]

  return createTrack({
    sourceId: SOURCE_ID,
    externalId: String(track.id),
    title: track.title?.trim() || 'Unknown Title',
    artist,
    album: album?.title,
    year: album?.year,
    durationMs: track.durationMs,
    coverUrl: buildYandexCoverUrl(track.coverUri ?? album?.coverUri),
    coverColor: COVER_COLOR,
    previewUrl: track.previewUrl ?? null,
    // available с /search — достоверный флаг API; undefined не угадываем.
    tags: withSearchPlayabilityTags(tags, track.available),
  })
}
