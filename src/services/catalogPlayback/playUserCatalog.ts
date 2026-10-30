import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Catalog } from '../../types/category.ts'
import type { Track } from '../../types/track.ts'
import type { AvailabilityPort } from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import type { PlaybackTrackLookup } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import type { ResolveMissingPlaybackTrack } from '../playbackAvailability/prepareCanonicalPlayback.ts'
import {
  buildCatalogPlaybackQueue,
  resolveCatalogItemPlayback,
  type CatalogItemResolution,
  type CatalogQueueEntry,
} from './buildCatalogPlaybackQueue.ts'
import { isAutoplayBlockedError } from './autoplayBlocked.ts'
import {
  applyCatalogLoopRepeatIfOwned,
  beginCatalogLoopSession,
  resetCatalogRepeatPolicyForTests,
} from './catalogRepeatPolicy.ts'
import { filterQueueToLiveCatalogMembership } from './liveCatalogQueue.ts'
import { CATALOG_PREPARE_CONCURRENCY } from './mapPool.ts'
import { CATALOG_PLAYBACK_MESSAGE } from './messages.ts'

export type PlayUserCatalogInput = {
  catalog: Pick<Catalog, 'id' | 'name'>
  items: readonly CanonicalLibraryItem[]
  /** Canonical id выбранной строки; без него — «Слушать каталог» с первого доступного. */
  startCanonicalTrackId?: string | null
}

export type PlaylistPlayContext = {
  type: 'playlist'
  id: string
  title: string
}

export type PlayUserCatalogDeps = {
  port?: AvailabilityPort
  findTrack?: PlaybackTrackLookup
  resolveMissingTrack?: ResolveMissingPlaybackTrack
  now?: number
  allowDemo?: boolean
  concurrency?: number
  playSelection?: (options: {
    tracks: Track[]
    startIndex: number
    context: PlaylistPlayContext
  }) => Promise<void>
  /**
   * Дополнить очередь после раннего старта без повторного playTrack.
   * Не должен сбрасывать позицию/историю; false = владелец сменился, no-op.
   */
  replaceQueue?: (options: {
    tracks: Track[]
    startIndex: number
    context: PlaylistPlayContext
  }) => boolean | void | Promise<boolean | void>
  onInFlight?: (count: number) => void
}

export type PlayUserCatalogResult =
  | {
      status: 'played'
      tracks: Track[]
      startIndex: number
      queue: CatalogQueueEntry[]
      /** Браузер заблокировал autoplay — нужен Play в BottomPlayer. */
      needsUserPlayGesture?: boolean
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
  resetCatalogRepeatPolicyForTests()
}

/**
 * Отмена in-flight (уход со страницы / смена catalogId).
 * Не трогает уже выставленную очередь плеера.
 */
export function cancelCatalogPlaybackGate(): void {
  activeGeneration += 1
  inFlight = false
}

function isCurrent(generation: number): boolean {
  return generation === activeGeneration
}

/**
 * Запуск пользовательского каталога как playlist-контекста.
 * Не трогает Recommendation Engine / Swipe / search-seed.
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

    if (!isCurrent(generation)) {
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    const context: PlaylistPlayContext = {
      type: 'playlist',
      id: input.catalog.id,
      title: input.catalog.name,
    }
    const resolveOpts = {
      port,
      findTrack: deps.findTrack,
      resolveMissingTrack,
      now: deps.now,
      allowDemo: deps.allowDemo,
    }

    const preResolved = new Map<string, CatalogItemResolution>()
    let needsUserPlayGesture = false
    let startedEarly = false
    const preferredId = input.startCanonicalTrackId ?? null
    /** Canonical id раннего старта (выбранный трек или первая доступная). */
    let earlyStartCanonicalId: string | null = preferredId

    const playEarlyTrack = async (entry: CatalogQueueEntry): Promise<'ok' | 'error'> => {
      const playSelection =
        deps.playSelection ??
        (await import('../playbackIntent/PlaybackIntent.ts')).playLibrarySelection
      try {
        await playSelection({
          tracks: [entry.track],
          startIndex: 0,
          context,
        })
      } catch (error) {
        if (isAutoplayBlockedError(error)) {
          needsUserPlayGesture = true
        } else {
          return 'error'
        }
      }
      startedEarly = true
      earlyStartCanonicalId = entry.canonicalTrackId
      // Новая явная сессия Play — не late expand.
      beginCatalogLoopSession(input.catalog.id)
      return 'ok'
    }

    if (preferredId) {
      const preferredItem = input.items.find(
        (item) => item.canonicalTrack.id === preferredId,
      )
      if (!preferredItem) {
        return {
          status: 'unavailable',
          message: CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE,
        }
      }
      const preferredResolution = await resolveCatalogItemPlayback(
        preferredItem,
        resolveOpts,
      )
      preResolved.set(preferredId, preferredResolution)

      if (!isCurrent(generation)) {
        return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
      }

      if (preferredResolution.status !== 'ready') {
        return {
          status: 'unavailable',
          message: preferredResolution.message,
        }
      }

      if ((await playEarlyTrack(preferredResolution.entry)) === 'error') {
        return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
      }

      if (!isCurrent(generation)) {
        return {
          status: 'played',
          tracks: [preferredResolution.entry.track],
          startIndex: 0,
          queue: [preferredResolution.entry],
          needsUserPlayGesture,
        }
      }
    } else {
      // «Слушать каталог»: старт с первой доступной, без ожидания всего списка.
      for (const item of input.items) {
        if (!isCurrent(generation)) {
          return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
        }
        const resolution = await resolveCatalogItemPlayback(item, resolveOpts)
        if (!isCurrent(generation)) {
          return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
        }
        preResolved.set(item.canonicalTrack.id, resolution)
        if (resolution.status !== 'ready') {
          continue
        }
        if ((await playEarlyTrack(resolution.entry)) === 'error') {
          return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
        }
        break
      }

      if (!startedEarly) {
        return {
          status: 'empty',
          message: CATALOG_PLAYBACK_MESSAGE.NO_PLAYABLE,
        }
      }

      if (!isCurrent(generation)) {
        const early = earlyStartCanonicalId
          ? preResolved.get(earlyStartCanonicalId)
          : null
        if (early?.status === 'ready') {
          return {
            status: 'played',
            tracks: [early.entry.track],
            startIndex: 0,
            queue: [early.entry],
            needsUserPlayGesture,
          }
        }
        return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
      }
    }

    let queue: CatalogQueueEntry[]
    let resolutions: CatalogItemResolution[]
    try {
      const built = await buildCatalogPlaybackQueue({
        items: input.items,
        ...resolveOpts,
        concurrency: deps.concurrency ?? CATALOG_PREPARE_CONCURRENCY,
        isCancelled: () => !isCurrent(generation),
        onInFlight: deps.onInFlight,
        preResolved,
        prioritizeCanonicalTrackId: earlyStartCanonicalId,
      })
      queue = built.queue
      resolutions = built.resolutions
    } catch {
      if (startedEarly) {
        return {
          status: 'played',
          tracks: [...preResolved.values()]
            .filter((row) => row.status === 'ready')
            .map((row) => (row.status === 'ready' ? row.entry.track : null))
            .filter((track): track is Track => Boolean(track)),
          startIndex: 0,
          queue: [...preResolved.values()]
            .filter((row) => row.status === 'ready')
            .map((row) => (row as Extract<CatalogItemResolution, { status: 'ready' }>).entry),
          needsUserPlayGesture,
        }
      }
      return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
    }

    if (!isCurrent(generation)) {
      if (startedEarly && earlyStartCanonicalId) {
        const early = preResolved.get(earlyStartCanonicalId)
        if (early?.status === 'ready') {
          return {
            status: 'played',
            tracks: [early.entry.track],
            startIndex: 0,
            queue: [early.entry],
            needsUserPlayGesture,
          }
        }
      }
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    if (preferredId) {
      const startEntry = queue.find((entry) => entry.canonicalTrackId === preferredId)
      if (!startEntry) {
        const itemResolution = resolutions.find(
          (row) =>
            row.status === 'unavailable' && row.canonicalTrackId === preferredId,
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

    const tracks = queue.map((entry) => entry.track)
    let startIndex = 0
    if (earlyStartCanonicalId) {
      const index = queue.findIndex(
        (entry) => entry.canonicalTrackId === earlyStartCanonicalId,
      )
      startIndex = index >= 0 ? index : 0
    }

    // Ранний старт всегда (preferred или первая доступная) — только expand, без повторного play.
    if (startedEarly) {
      const replaceQueue =
        deps.replaceQueue ??
        (async (options) => {
          const { getPlaybackQueue } = await import('../playbackQueue/PlaybackQueue.ts')
          return getPlaybackQueue().replacePlaylistItemsPreservingPlayback(
            options.tracks,
            { type: 'playlist', id: options.context.id },
          )
        })
      // generation + ownership: чужой/устаревший prepare не трогает очередь и Repeat.
      // Live membership: разобранные во время prepare не возвращаются expand'ом.
      if (isCurrent(generation)) {
        const liveQueue = filterQueueToLiveCatalogMembership(
          input.catalog.id,
          queue,
        )
        const liveTracks = liveQueue.map((entry) => entry.track)
        let liveStart = 0
        if (earlyStartCanonicalId) {
          const index = liveQueue.findIndex(
            (entry) => entry.canonicalTrackId === earlyStartCanonicalId,
          )
          liveStart = index >= 0 ? index : 0
        }
        if (liveTracks.length > 0) {
          await replaceQueue({
            tracks: liveTracks,
            startIndex: liveStart,
            context,
          })
          applyCatalogLoopRepeatIfOwned(input.catalog.id)
        }
        return {
          status: 'played',
          tracks: liveTracks.length > 0 ? liveTracks : tracks,
          startIndex: liveTracks.length > 0 ? liveStart : startIndex,
          queue: liveQueue.length > 0 ? liveQueue : queue,
          needsUserPlayGesture,
        }
      }
      return {
        status: 'played',
        tracks,
        startIndex,
        queue,
        needsUserPlayGesture,
      }
    }

    // На случай если early-path не сработал (не должно при штатном потоке).
    try {
      const playSelection =
        deps.playSelection ??
        (await import('../playbackIntent/PlaybackIntent.ts')).playLibrarySelection
      if (!isCurrent(generation)) {
        return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
      }
      await playSelection({
        tracks,
        startIndex,
        context,
      })
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        applyCatalogLoopRepeatIfOwned(input.catalog.id)
        return {
          status: 'played',
          tracks,
          startIndex,
          queue,
          needsUserPlayGesture: true,
        }
      }
      return { status: 'error', message: CATALOG_PLAYBACK_MESSAGE.FAILED }
    }

    if (!isCurrent(generation)) {
      return { status: 'busy', message: CATALOG_PLAYBACK_MESSAGE.BUSY }
    }

    applyCatalogLoopRepeatIfOwned(input.catalog.id)
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
