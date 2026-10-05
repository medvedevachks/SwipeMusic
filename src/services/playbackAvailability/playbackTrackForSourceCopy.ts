import { getCollectionEngine } from '../collectionEngine/index.ts'
import { copyTrack } from '../libraryPersistence/mapLibraryState.ts'
import type { SourceCopy } from '../../types/canonical.ts'
import { PLAYABLE_SOURCE_SELECTION_REASON } from '../../types/playableSourceSelection.ts'
import type { Track } from '../../types/track.ts'

export type PlaybackTrackLookup = (sourceTrackKey: string) => Track | null

export type PlaybackTrackForSourceCopy =
  | { track: Track }
  | {
      track: null
      reason: typeof PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING
    }

/**
 * Берёт уже сохранённый source Track.
 * SourceCopy не содержит playback URL, и этот helper его не выдумывает.
 */
export function getPlaybackTrackForSourceCopy(
  copy: SourceCopy,
  findTrack: PlaybackTrackLookup,
): PlaybackTrackForSourceCopy {
  const found = findTrack(copy.sourceTrackKey)
  if (!found || !snapshotMatchesCopy(found, copy)) {
    return {
      track: null,
      reason: PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING,
    }
  }
  return { track: copyTrack(found) }
}

/** Снимок коллекции по sourceTrackKey. Canonical state не читается и не пишется. */
export function findCollectionPlaybackTrack(sourceTrackKey: string): Track | null {
  const engine = getCollectionEngine()
  const direct = engine.getTrack(sourceTrackKey)
  if (direct?.track) {
    return direct.track
  }
  const listed = engine.listTracks({ includeHidden: true }).find((record) => {
    const track = record.track
    return (
      track.id === sourceTrackKey ||
      `${track.sourceId}:${track.externalId}` === sourceTrackKey
    )
  })
  return listed?.track ?? null
}

function snapshotMatchesCopy(track: Track, copy: SourceCopy): boolean {
  if (track.sourceId !== copy.sourceId || track.externalId !== copy.externalId) {
    return false
  }
  return (
    track.id === copy.sourceTrackKey ||
    `${track.sourceId}:${track.externalId}` === copy.sourceTrackKey
  )
}
