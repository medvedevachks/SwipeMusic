import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Catalog } from '../../types/category.ts'
import type { Track } from '../../types/track.ts'
import type { AvailabilityPort } from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import type { PlaybackTrackLookup } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import type { ResolveMissingPlaybackTrack } from '../playbackAvailability/prepareCanonicalPlayback.ts'
import {
  buildCatalogPlaybackQueue,
  type CatalogQueueEntry,
} from './buildCatalogPlaybackQueue.ts'
import { isAutoplayBlockedError } from './autoplayBlocked.ts'
import { CATALOG_PLAYBACK_MESSAGE } from './messages.ts'

export type PlayUserCatalogInput = {
  catalog: Pick<Catalog, 'id' | 'name'>
  items: readonly CanonicalLibraryItem[]
  /** Canonical id выбранной строки; без него — «Слушать каталог» с первого доступного. */
  startCanonicalTrackId?: string | null
}

export type PlayUserCatalogDeps = {
  port?: AvailabilityPort
  findTrack?: PlaybackTrackLookup
  resolveMissingTrack?: ResolveMissingPlaybackTrack
  now?: number
  allowDemo?: boolean
  playSelection?: (options: {
    tracks: Track[]
    startIndex: number
    context: { type: 'playlist'; id: string; title: string }
  }) => Promise<void>
}

export type PlayUserCatalogResult =
  | {
      status: 'played'
      tracks: Track[]
      startIndex: number
      queue: CatalogQueueEntry[]
    }
  | {
      status: 'empty'
      message: string
    }
  | {
      status: 'unavailable'
      message: string
    }
  | {
      status: 'error'
      message: string
    }
  | {
      status: 'busy'
      message: string
    }

let activeGeneration = 0
let inFlight = false

/** Сброс для unit-тестов. */
export function resetCatalogPlaybackGate(): void {
  activeGeneration = 0
  inFlight = false
}

/**
 * Отмена in-flight (уход со страницы / смена catalogId).
 * Не трогает уже выставленную очередь плеера.
 */
export function cancelCatalogPlaybackGate(): void {
  activeGeneration += 1
  inFlight = false
}

/**
 * Запуск пользовательского каталога как playlist-контекста.
 * Не трогает Recommendation Engine / Swipe / search-seed.
 *
 * NotAllowedError после setQueue/load — не FAILED: AudioPlayer уже держит трек
 * на паузе (существующий путь iOS / Safari без искусственного autoplay unlock).
 */
export async function playUserCatalog(
  input: PlayUserCatalogInput,
  deps: PlayUserCatalogDeps = {},
): Promise<PlayUserCatalogResult> {
  if (inFlight) {
    return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
  }

  const generation = ++activeGeneration
  inFlight = true

  try {
    if (input.items.length === 0) {
      return {
        status: 'empty',
        message: CATALOG_PLAYBACK_MESSAGE.EMPTY_CATALOG,
      }
    }

    const port =
      deps.port ??
      (await import('../playbackAvailability/registryPort.ts')).createSourceRegistryAvailabilityPort()
    const resolveMissingTrack: ResolveMissingPlaybackTrack =
      deps.resolveMissingTrack ??
      (async (copy) => {
        const mod = await import('./resolveMissingCatalogTrack.ts')
        return mod.resolveMissingCatalogTrack(copy)
      })

    if (generation !== activeGeneration) {
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    let queue: CatalogQueueEntry[]
    try {
      const built = await buildCatalogPlaybackQueue({
        items: input.items,
        port,
        findTrack: deps.findTrack,
        resolveMissingTrack,
        now: deps.now,
        allowDemo: deps.allowDemo,
      })
      queue = built.queue

      if (generation !== activeGeneration) {
        return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
      }

      const startCanonicalId = input.startCanonicalTrackId ?? null
      if (startCanonicalId) {
        const startEntry = queue.find(
          (entry) => entry.canonicalTrackId === startCanonicalId,
        )
        if (!startEntry) {
          const itemResolution = built.resolutions.find(
            (row) =>
              row.status === 'unavailable' &&
              row.canonicalTrackId === startCanonicalId,
          )
          return {
            status: 'unavailable',
            message:
              itemResolution && itemResolution.status === 'unavailable'
                ? itemResolution.message
                : CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE,
          }
        }
      }

      if (queue.length === 0) {
        return {
          status: 'empty',
          message: CATALOG_PLAYBACK_MESSAGE.NO_PLAYABLE,
        }
      }
    } catch {
      return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
    }

    const tracks = queue.map((entry) => entry.track)
    let startIndex = 0
    if (input.startCanonicalTrackId) {
      const index = queue.findIndex(
        (entry) => entry.canonicalTrackId === input.startCanonicalTrackId,
      )
      startIndex = index >= 0 ? index : 0
    }

    if (generation !== activeGeneration) {
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    try {
      const playSelection =
        deps.playSelection ??
        (await import('../playbackIntent/PlaybackIntent.ts')).playLibrarySelection
      if (generation !== activeGeneration) {
        return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
      }
      await playSelection({
        tracks,
        startIndex,
        context: {
          type: 'playlist',
          id: input.catalog.id,
          title: input.catalog.name,
        },
      })
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        // Очередь и load уже в AudioPlayer; нужен повторный Play в BottomPlayer.
        return {
          status: 'played',
          tracks,
          startIndex,
          queue,
        }
      }
      return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
    }

    if (generation !== activeGeneration) {
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    return {
      status: 'played',
      tracks,
      startIndex,
      queue,
    }
  } finally {
    if (generation === activeGeneration) {
      inFlight = false
    }
  }
}
