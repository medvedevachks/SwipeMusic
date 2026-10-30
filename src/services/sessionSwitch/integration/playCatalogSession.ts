/**
 * Play пользовательского каталога через SessionSwitchCoordinator (DEV-06).
 * Одна логическая CATALOG-сессия для всех catalogId.
 */
import type { Track } from '../../../types/track.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import {
  createEmptySessionQueueSnapshot,
} from '../../playbackSession/PlaybackSessionStore.ts'
import type { SessionQueueSnapshot } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { playbackExportToSessionQueue } from '../queueSnapshotBridge.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type PlayCatalogSessionInput = {
  tracks: Track[]
  startIndex: number
  catalogId: string
  catalogTitle: string
}

export type PlayCatalogSessionResult =
  | { ok: true; needsUserPlayGesture?: boolean }
  | {
      ok: false
      reason:
        | 'flag_off'
        | 'no_runtime'
        | 'empty'
        | 'prepare_failed'
        | 'commit_failed'
        | 'user_gesture_required'
        | 'stale'
        | 'error'
      message?: string
    }

function buildCatalogQueueSnapshot(
  tracks: Track[],
  startIndex: number,
  catalogId: string,
  catalogTitle: string,
): SessionQueueSnapshot {
  const now = new Date().toISOString()
  const items = tracks.map((t) => toSessionTrack(t))
  const index =
    items.length === 0
      ? -1
      : Math.min(Math.max(0, startIndex), items.length - 1)
  const startId = index >= 0 ? items[index]!.id : null
  return {
    ...createEmptySessionQueueSnapshot(now),
    items,
    currentIndex: index,
    playOrder: items.map((_, i) => i),
    playOrderIndex: index,
    history: startId ? [startId] : [],
    historyIndex: startId ? 0 : -1,
    context: {
      type: 'playlist',
      id: catalogId,
      title: catalogTitle,
    },
    sessionTailIds: [],
    positionSeconds: 0,
    phase: 'playing',
    updatedAt: now,
  }
}

/**
 * Полный switch в CATALOG-сессию (Catalog A→B тоже здесь).
 */
export async function playCatalogViaSessionSwitch(
  input: PlayCatalogSessionInput,
): Promise<PlayCatalogSessionResult> {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { ok: false, reason: 'flag_off' }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { ok: false, reason: 'no_runtime' }
  }
  if (input.tracks.length === 0) {
    return { ok: false, reason: 'empty', message: 'empty catalog queue' }
  }
  const startIndex = Math.min(
    Math.max(0, input.startIndex),
    input.tracks.length - 1,
  )
  const startTrack = input.tracks[startIndex]!
  const targetQueue = buildCatalogQueueSnapshot(
    input.tracks,
    startIndex,
    input.catalogId,
    input.catalogTitle,
  )

  const result = await runtime.coordinator.switchTo({
    target: 'catalog',
    meta: {
      kind: 'catalog',
      catalogId: input.catalogId,
      title: input.catalogTitle,
    },
    targetQueue,
    startTrackId: startTrack.id,
  })

  if (result.ok) {
    return { ok: true }
  }
  if (result.reason === 'user_gesture_required') {
    return {
      ok: false,
      reason: 'user_gesture_required',
      message: result.message,
    }
  }
  if (result.reason === 'prepare_failed') {
    return { ok: false, reason: 'prepare_failed', message: result.message }
  }
  if (result.reason === 'stale') {
    return { ok: false, reason: 'stale', message: result.message }
  }
  return {
    ok: false,
    reason: 'commit_failed',
    message: result.message ?? result.reason,
  }
}

/**
 * Late expand очереди каталога без повторного physical play.
 * Обновляет live queue + durable CATALOG slot.
 */
export function expandCatalogSessionQueue(options: {
  tracks: Track[]
  startIndex: number
  catalogId: string
  catalogTitle: string
}): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return false
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime || runtime.store.getActiveSessionId() !== 'catalog') {
    return false
  }

  const queue = runtime.queue
  const replaced = queue.replacePlaylistItemsPreservingPlayback(options.tracks, {
    type: 'playlist',
    id: options.catalogId,
  })
  if (!replaced) {
    return false
  }

  const snap = playbackExportToSessionQueue(queue.exportSessionState(), {
    positionSeconds: runtime.player.getPositionSeconds(),
    playingTrackId: runtime.player.getCurrentTrackId(),
    pendingRemovalIds: queue.getPendingRemovalIds(),
    phase: 'playing',
    updatedAt: new Date().toISOString(),
  })
  runtime.store.replaceSlot('catalog', {
    meta: {
      kind: 'catalog',
      catalogId: options.catalogId,
      title: options.catalogTitle,
    },
    queue: snap,
  })
  return true
}

export function isCatalogSessionPlaybackActive(): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return false
  }
  return getSessionSwitchAppRuntime()?.store.getActiveSessionId() === 'catalog'
}
