/**
 * Сохранение активной session-slot из live queue + player (DEV-07).
 * Не пишет legacy v1. Не мутирует PlaybackQueue (только export).
 */
import type { PlaybackContext } from '../../../types/playbackContext.ts'
import type {
  PlaybackSessionId,
  SessionPlaybackPhase,
} from '../../playbackSession/types.ts'
import { playbackExportToSessionQueue } from '../queueSnapshotBridge.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type FlushActiveSessionReason =
  | 'queue'
  | 'pause'
  | 'seek'
  | 'position'
  | 'visibility'
  | 'pagehide'
  | 'release'
  | 'manual'
  | 'switch'

export type FlushActiveSessionResult =
  | {
      flushed: true
      sessionId: PlaybackSessionId
      revision: number
      bumpGeneration: boolean
    }
  | {
      flushed: false
      reason:
        | 'no_runtime'
        | 'no_active'
        | 'no_user'
        | 'stale_revision'
        | 'user_mismatch'
        | 'context_mismatch'
    }

/** Монотонный revision flush'ей; устаревший scheduled flush не пишет. */
let flushRevision = 0

export function bumpFlushRevision(): number {
  flushRevision += 1
  return flushRevision
}

export function getFlushRevision(): number {
  return flushRevision
}

export function resetFlushRevisionForTests(): void {
  flushRevision = 0
}

/**
 * Не писать чужой live context в слот (гонка: import target до setActive).
 */
export function liveContextMatchesSession(
  sessionId: PlaybackSessionId,
  context: PlaybackContext,
): boolean {
  switch (sessionId) {
    case 'search':
      return context.type === 'search-seed' || context.type === 'search'
    case 'album':
      return context.type === 'album'
    case 'catalog':
      return context.type === 'playlist'
    case 'wave':
      return context.type === 'radio'
    case 'swipes':
      return context.type === 'swipe'
    default:
      return false
  }
}

function resolvePhase(
  reason: FlushActiveSessionReason,
  playing: boolean | undefined,
): SessionPlaybackPhase {
  if (
    reason === 'pause' ||
    reason === 'pagehide' ||
    reason === 'visibility' ||
    reason === 'release'
  ) {
    return 'user_paused'
  }
  if (typeof playing === 'boolean') {
    return playing ? 'playing' : 'user_paused'
  }
  return 'playing'
}

/**
 * Снимок live → durable active slot + persistence.
 * `expectedRevision`: если задан и устарел — no-op (антистейл).
 */
export function flushActiveSessionToStore(options: {
  reason: FlushActiveSessionReason
  expectedRevision?: number
  /** Явный session id (release до setActive null). */
  sessionId?: PlaybackSessionId
  clearActiveAfter?: boolean
  /** true = только position/phase, без bump slotGeneration. */
  positionOnly?: boolean
  playing?: boolean
}): FlushActiveSessionResult {
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { flushed: false, reason: 'no_runtime' }
  }

  if (
    typeof options.expectedRevision === 'number' &&
    options.expectedRevision !== flushRevision
  ) {
    return { flushed: false, reason: 'stale_revision' }
  }

  const sessionId =
    options.sessionId ?? runtime.store.getActiveSessionId()
  if (!sessionId) {
    return { flushed: false, reason: 'no_active' }
  }

  const userId = runtime.store.getUserId()
  if (!userId || userId !== runtime.userId) {
    return { flushed: false, reason: 'user_mismatch' }
  }

  const exported = runtime.queue.exportSessionState()
  // release/manual/switch — вызывающий уже зафиксировал нужный live snapshot
  // или очищает active; mismatch guard только для фонового sync.
  if (
    options.reason !== 'release' &&
    options.reason !== 'switch' &&
    options.reason !== 'manual' &&
    !liveContextMatchesSession(sessionId, exported.context)
  ) {
    return { flushed: false, reason: 'context_mismatch' }
  }

  const phase = resolvePhase(options.reason, options.playing)
  const snap = playbackExportToSessionQueue(exported, {
    positionSeconds: runtime.player.getPositionSeconds(),
    playingTrackId: runtime.player.getCurrentTrackId(),
    pendingRemovalIds: runtime.queue.getPendingRemovalIds(),
    phase,
    updatedAt: new Date().toISOString(),
  })

  const positionOnly =
    options.positionOnly === true || options.reason === 'position'

  if (positionOnly) {
    runtime.store.saveSlotRuntime(sessionId, {
      positionSeconds: snap.positionSeconds,
      phase: snap.phase,
      updatedAt: snap.updatedAt,
    })
  } else {
    const prevMeta = runtime.store.getSlot(sessionId).meta
    runtime.store.replaceSlot(sessionId, {
      meta: prevMeta,
      queue: snap,
    })
  }

  try {
    runtime.persistence.saveSlot(
      userId,
      runtime.deviceId,
      runtime.store.getSlot(sessionId),
    )
    runtime.persistence.saveMeta(userId, runtime.deviceId, {
      activeSessionId: options.clearActiveAfter
        ? null
        : runtime.store.getActiveSessionId(),
      switchEpoch: runtime.store.getSwitchEpoch(),
      playRequestId: runtime.store.getPlayRequestId(),
    })
  } catch {
    // best-effort disk
  }

  if (options.clearActiveAfter) {
    runtime.store.setActiveSessionId(null)
  }

  return {
    flushed: true,
    sessionId,
    revision: flushRevision,
    bumpGeneration: !positionOnly,
  }
}
