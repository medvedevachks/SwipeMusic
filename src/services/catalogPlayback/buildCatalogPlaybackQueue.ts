import type { CanonicalLibraryItem, SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import {
  prepareCanonicalPlayback,
  type PrepareCanonicalPlaybackOptions,
  type ResolveMissingPlaybackTrack,
} from '../playbackAvailability/prepareCanonicalPlayback.ts'
import type { AvailabilityPort } from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import {
  isPlaybackHandoffReady,
  PLAYABLE_SOURCE_SELECTION_REASON,
  type PlayableSourceSelection,
} from '../../types/playableSourceSelection.ts'
import type { PlaybackTrackLookup } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import { CATALOG_PLAYBACK_MESSAGE } from './messages.ts'

export type CatalogQueueEntry = {
  canonicalTrackId: string
  track: Track
  selection: PlayableSourceSelection
}

export type CatalogItemResolution =
  | { status: 'ready'; entry: CatalogQueueEntry }
  | {
      status: 'unavailable'
      canonicalTrackId: string
      selection: PlayableSourceSelection
      message: string
    }

export type BuildCatalogPlaybackQueueInput = {
  items: readonly CanonicalLibraryItem[]
  port: AvailabilityPort
  findTrack?: PlaybackTrackLookup
  resolveMissingTrack?: ResolveMissingPlaybackTrack
  now?: number
  /** Только для тестов / harness. В production demo не попадает в очередь. */
  allowDemo?: boolean
}

export type BuildCatalogPlaybackQueueResult = {
  queue: CatalogQueueEntry[]
  resolutions: CatalogItemResolution[]
}

function copiesForPlayback(
  copies: readonly SourceCopy[],
  allowDemo: boolean,
): SourceCopy[] {
  if (allowDemo) {
    return [...copies]
  }
  return copies.filter((copy) => !isDemoSourceId(copy.sourceId))
}

function messageForSelection(selection: PlayableSourceSelection): string {
  if (selection.reason === PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING) {
    return CATALOG_PLAYBACK_MESSAGE.SNAPSHOT_MISSING
  }
  const disabled = selection.availability.copies.some(
    (copy) => copy.reason === 'SOURCE_DISABLED',
  )
  if (disabled && !selection.availability.hasPlayableCopy) {
    return CATALOG_PLAYBACK_MESSAGE.SOURCE_DISABLED
  }
  return CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE
}

export async function resolveCatalogItemPlayback(
  item: CanonicalLibraryItem,
  options: {
    port: AvailabilityPort
    findTrack?: PlaybackTrackLookup
    resolveMissingTrack?: ResolveMissingPlaybackTrack
    now?: number
    allowDemo?: boolean
  },
): Promise<CatalogItemResolution> {
  const canonicalTrackId = item.canonicalTrack.id
  const copies = copiesForPlayback(item.copies, Boolean(options.allowDemo))
  if (copies.length === 0) {
    const empty: PlayableSourceSelection = {
      canonicalTrackId,
      selectedCopy: null,
      selectedTrack: null,
      availability: {
        canonicalTrackId,
        copies: [],
        playableCopies: [],
        hasPlayableCopy: false,
      },
      reason: PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY,
    }
    return {
      status: 'unavailable',
      canonicalTrackId,
      selection: empty,
      message: CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE,
    }
  }

  const prepareOptions: PrepareCanonicalPlaybackOptions = {
    port: options.port,
    findTrack: options.findTrack,
    resolveMissingTrack: options.resolveMissingTrack,
    now: options.now,
  }
  const selection = await prepareCanonicalPlayback(
    { canonicalTrackId, copies },
    prepareOptions,
  )

  if (!isPlaybackHandoffReady(selection) || !selection.selectedTrack) {
    return {
      status: 'unavailable',
      canonicalTrackId,
      selection,
      message: messageForSelection(selection),
    }
  }

  return {
    status: 'ready',
    entry: {
      canonicalTrackId,
      track: selection.selectedTrack,
      selection,
    },
  }
}

/**
 * Собирает очередь только из реально доступных композиций (порядок каталога).
 * Demo-only и недоступные копии в очередь не попадают.
 * Availability резолвится параллельно — короче путь до AudioPlayer (iOS activation).
 */
export async function buildCatalogPlaybackQueue(
  input: BuildCatalogPlaybackQueueInput,
): Promise<BuildCatalogPlaybackQueueResult> {
  const resolutions = await Promise.all(
    input.items.map((item) =>
      resolveCatalogItemPlayback(item, {
        port: input.port,
        findTrack: input.findTrack,
        resolveMissingTrack: input.resolveMissingTrack,
        now: input.now,
        allowDemo: input.allowDemo,
      }),
    ),
  )

  const queue: CatalogQueueEntry[] = []
  for (const resolved of resolutions) {
    if (resolved.status === 'ready') {
      queue.push(resolved.entry)
    }
  }

  return { queue, resolutions }
}
