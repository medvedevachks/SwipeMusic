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
import {
  CATALOG_PREPARE_CONCURRENCY,
  mapPool,
} from './mapPool.ts'

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
  concurrency?: number
  isCancelled?: () => boolean
  onInFlight?: (count: number) => void
  /**
   * Уже готовые резолюции (например выбранный трек) — не перепроверять.
   * Ключ: canonicalTrackId.
   */
  preResolved?: ReadonlyMap<string, CatalogItemResolution>
  /** Сначала резолвится этот canonical id (порядок очереди не меняется). */
  prioritizeCanonicalTrackId?: string | null
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
 */
export async function buildCatalogPlaybackQueue(
  input: BuildCatalogPlaybackQueueInput,
): Promise<BuildCatalogPlaybackQueueResult> {
  const concurrency = input.concurrency ?? CATALOG_PREPARE_CONCURRENCY
  const preResolved = input.preResolved
  const resolveOne = (item: CanonicalLibraryItem) => {
    const cached = preResolved?.get(item.canonicalTrack.id)
    if (cached) {
      return Promise.resolve(cached)
    }
    return resolveCatalogItemPlayback(item, {
      port: input.port,
      findTrack: input.findTrack,
      resolveMissingTrack: input.resolveMissingTrack,
      now: input.now,
      allowDemo: input.allowDemo,
    })
  }

  const resolutions = new Array<CatalogItemResolution>(input.items.length)
  const prioritizeId = input.prioritizeCanonicalTrackId ?? null
  if (prioritizeId) {
    const priorityIndex = input.items.findIndex(
      (item) => item.canonicalTrack.id === prioritizeId,
    )
    if (priorityIndex >= 0) {
      if (input.isCancelled?.()) {
        return { queue: [], resolutions: [] }
      }
      resolutions[priorityIndex] = await resolveOne(input.items[priorityIndex]!)
    }
  }

  const pendingIndexes: number[] = []
  for (let index = 0; index < input.items.length; index += 1) {
    if (!resolutions[index]) {
      pendingIndexes.push(index)
    }
  }

  await mapPool(
    pendingIndexes,
    concurrency,
    async (index) => {
      if (input.isCancelled?.()) {
        return index
      }
      resolutions[index] = await resolveOne(input.items[index]!)
      return index
    },
    {
      isCancelled: input.isCancelled,
      onInFlight: input.onInFlight,
    },
  )

  if (input.isCancelled?.()) {
    return { queue: [], resolutions: resolutions.filter(Boolean) }
  }

  const complete = resolutions.map((row, index) => {
    if (row) {
      return row
    }
    // Отмена посреди пула — пометим оставшиеся как unavailable без probe.
    const item = input.items[index]!
    return {
      status: 'unavailable' as const,
      canonicalTrackId: item.canonicalTrack.id,
      selection: {
        canonicalTrackId: item.canonicalTrack.id,
        selectedCopy: null,
        selectedTrack: null,
        availability: {
          canonicalTrackId: item.canonicalTrack.id,
          copies: [],
          playableCopies: [],
          hasPlayableCopy: false,
        },
        reason: PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY,
      },
      message: CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE,
    }
  })

  const queue: CatalogQueueEntry[] = []
  for (const resolved of complete) {
    if (resolved.status === 'ready') {
      queue.push(resolved.entry)
    }
  }

  return { queue, resolutions: complete }
}
