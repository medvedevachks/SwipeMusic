/**
 * Pure helper: same-artist library tracks for album related (PLAYBACK-CME-01).
 */
import type { Track } from '../../../types/track.ts'
import { useCanonicalLibraryStore } from '../../../store/canonicalLibraryStore.ts'
import { isDemoSourceId } from '../../../sources/demoSource.ts'
import type { AlbumSessionMeta } from '../../playbackSession/types.ts'

const RELATED_CAP = 8

function normalizeArtist(value: string): string {
  return value.trim().toLowerCase()
}

export function buildAlbumRelatedTracks(input: {
  meta: AlbumSessionMeta
  lastTrack: Track | null
  excludeIds: ReadonlySet<string>
}): Track[] {
  const artistHint =
    input.meta.artist?.trim() ||
    input.lastTrack?.artist?.trim() ||
    ''
  if (!artistHint) {
    return []
  }
  const want = normalizeArtist(artistHint)
  const items = Object.values(useCanonicalLibraryStore.getState().itemsById)
  const out: Track[] = []
  for (const item of items) {
    if (item.state.hidden || item.state.disliked) {
      continue
    }
    const artist = normalizeArtist(
      item.canonicalTrack.artist || item.copies[0]?.artist || '',
    )
    if (!artist || artist !== want) {
      continue
    }
    const copy = item.copies.find(
      (c) => c.externalId && !isDemoSourceId(c.sourceId),
    )
    if (!copy) {
      continue
    }
    const id = `${copy.sourceId}:${copy.externalId}`
    if (
      input.excludeIds.has(id) ||
      input.excludeIds.has(item.canonicalTrack.id)
    ) {
      continue
    }
    out.push({
      id,
      sourceId: copy.sourceId,
      externalId: copy.externalId,
      title: copy.title || item.canonicalTrack.title,
      artist: copy.artist || item.canonicalTrack.artist,
      album: item.canonicalTrack.album ?? undefined,
      durationMs: item.canonicalTrack.durationMs ?? undefined,
      coverUrl: item.canonicalTrack.artworkUrl,
      previewUrl: null,
    })
    if (out.length >= RELATED_CAP) {
      break
    }
  }
  return out
}
