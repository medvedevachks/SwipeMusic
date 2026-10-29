import type { SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import {
  PLAYABLE_SOURCE_SELECTION_REASON,
  type PlayableSourceSelection,
} from '../../types/playableSourceSelection.ts'
import {
  resolveCanonicalPlaybackAvailability,
  type AvailabilityPort,
} from './resolveCanonicalPlaybackAvailability.ts'
import {
  findCollectionPlaybackTrack,
  getPlaybackTrackForSourceCopy,
  type PlaybackTrackLookup,
} from './playbackTrackForSourceCopy.ts'
import { selectPlayableSourceCopy } from './selectPlayableSourceCopy.ts'

export type PrepareCanonicalPlaybackInput = {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  preferredSourceTrackKey?: string | null
}

export type ResolveMissingPlaybackTrack = (
  copy: SourceCopy,
) => Promise<Track | null> | Track | null

export type PrepareCanonicalPlaybackOptions = {
  port: AvailabilityPort
  now?: number
  ttlMs?: number
  findTrack?: PlaybackTrackLookup
  /**
   * Официальный путь адаптера (getTrack), если снимка нет в CollectionEngine.
   * URL и SourceCopy здесь не выдумываются; identity должна совпасть с copy.
   */
  resolveMissingTrack?: ResolveMissingPlaybackTrack
}

/**
 * Availability → одна PLAYABLE SourceCopy → существующий source Track.
 * AudioPlayer не вызывается. После ошибки playback вторая copy не выбирается:
 * повторного прохода здесь нет.
 */
export async function prepareCanonicalPlayback(
  input: PrepareCanonicalPlaybackInput,
  options: PrepareCanonicalPlaybackOptions,
): Promise<PlayableSourceSelection> {
  const availability = await resolveCanonicalPlaybackAvailability(
    {
      canonicalTrackId: input.canonicalTrackId,
      copies: input.copies,
    },
    {
      port: options.port,
      now: options.now,
      ttlMs: options.ttlMs,
    },
  )
  const selected = selectPlayableSourceCopy({
    canonicalTrackId: input.canonicalTrackId,
    copies: input.copies,
    availability,
    preferredSourceTrackKey: input.preferredSourceTrackKey,
  })
  if (!selected.selectedCopy) {
    return selected
  }

  const findTrack = options.findTrack ?? findCollectionPlaybackTrack
  const snapshot = getPlaybackTrackForSourceCopy(selected.selectedCopy, findTrack)
  if (snapshot.track) {
    return {
      ...selected,
      selectedTrack: snapshot.track,
    }
  }

  if (options.resolveMissingTrack) {
    const hydrated = await options.resolveMissingTrack(selected.selectedCopy)
    if (hydrated) {
      const fromAdapter = getPlaybackTrackForSourceCopy(
        selected.selectedCopy,
        () => hydrated,
      )
      if (fromAdapter.track) {
        return {
          ...selected,
          selectedTrack: fromAdapter.track,
        }
      }
    }
  }

  return {
    ...selected,
    selectedTrack: null,
    reason: PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING,
  }
}
