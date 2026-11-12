/**
 * Play seed «Свайпы» через SessionSwitch (DEV-08).
 * SWIPES — отдельный слот; очередь = стартовая композиция + CME continuation.
 */
import type { Track } from '../../../types/track.ts'
import {
  createEmptySessionQueueSnapshot,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import type { SessionQueueSnapshot } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { bindCmeOwnershipFromRuntime } from './cmeSessionOwnership.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type PlaySwipeSessionInput = {
  track: Track
}

export type PlaySwipeSessionResult =
  | { ok: true }
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

function buildSwipeQueueSnapshot(track: Track): SessionQueueSnapshot {
  const now = new Date().toISOString()
  const item = toSessionTrack(track)
  return {
    ...createEmptySessionQueueSnapshot(now),
    items: [item],
    currentIndex: 0,
    playOrder: [0],
    playOrderIndex: 0,
    history: [item.id],
    historyIndex: 0,
    context: { type: 'swipe' },
    sessionTailIds: [],
    positionSeconds: 0,
    phase: 'playing',
    updatedAt: now,
  }
}

export async function playSwipeViaSessionSwitch(
  input: PlaySwipeSessionInput,
): Promise<PlaySwipeSessionResult> {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { ok: false, reason: 'flag_off' }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { ok: false, reason: 'no_runtime' }
  }
  if (!input.track?.id) {
    return { ok: false, reason: 'empty', message: 'empty swipe track' }
  }

  const result = await runtime.coordinator.switchTo({
    target: 'swipes',
    meta: { kind: 'swipes' },
    targetQueue: buildSwipeQueueSnapshot(input.track),
    startTrackId: input.track.id,
  })

  if (result.ok) {
    bindCmeOwnershipFromRuntime('swipes')
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

export function isSwipeSessionPlaybackActive(): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return false
  }
  return getSessionSwitchAppRuntime()?.store.getActiveSessionId() === 'swipes'
}
