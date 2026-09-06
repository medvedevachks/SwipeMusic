import type { Track } from '../../types/track'
import type { TrackMetadata, TrackRecord } from './types'

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Ключ дедупликации:
 * ISRC → MusicBrainz → hash → externalId+source → title+artist+duration
 */
export function computeDedupeKey(
  track: Track,
  metadata: TrackMetadata,
  hash?: string,
): string {
  if (metadata.isrc) {
    return `isrc:${normalizeKey(metadata.isrc)}`
  }
  if (metadata.musicBrainzId) {
    return `mbid:${normalizeKey(metadata.musicBrainzId)}`
  }
  if (hash) {
    return `hash:${hash}`
  }
  const durationBucket =
    metadata.durationMs != null
      ? Math.round(metadata.durationMs / 1000)
      : track.durationMs != null
        ? Math.round(track.durationMs / 1000)
        : 0
  return `ta:${normalizeKey(track.title)}|${normalizeKey(track.artist)}|${durationBucket}`
}

export function mergeRecords(
  existing: TrackRecord,
  incoming: TrackRecord,
): TrackRecord {
  const copies = [...existing.copies]
  for (const copy of incoming.copies) {
    const idx = copies.findIndex(
      (item) =>
        item.sourceId === copy.sourceId && item.externalId === copy.externalId,
    )
    if (idx >= 0) {
      copies[idx] = copy
    } else {
      copies.push(copy)
    }
  }

  return {
    ...existing,
    // Предпочитаем более свежий snapshot, но сохраняем id существующей записи.
    track: {
      ...incoming.track,
      id: existing.id,
      previewUrl: null,
    },
    metadata: { ...existing.metadata, ...incoming.metadata },
    path: incoming.path ?? existing.path,
    hash: incoming.hash ?? existing.hash,
    modifiedAt: incoming.modifiedAt,
    lastSynced: incoming.lastSynced,
    copies,
    unavailable: false,
  }
}
