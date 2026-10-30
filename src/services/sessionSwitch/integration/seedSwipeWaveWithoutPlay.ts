/**
 * Холодный seed SWIPES/WAVE без commitPlay / autoplay (DEV-08).
 * Не затирает непустую live queue (вызывающий обязан проверить).
 */
import type { Track } from '../../../types/track.ts'
import {
  createEmptySessionQueueSnapshot,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import {
  sessionQueueToPlaybackQueueState,
} from '../queueSnapshotBridge.ts'
import { bindCmeOwnershipFromRuntime } from './cmeSessionOwnership.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export function seedSwipeOrWaveSessionWithoutPlay(input: {
  mode: 'swipe' | 'wave'
  track: Track
}): { ok: boolean } {
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime || !input.track?.id) {
    return { ok: false }
  }

  const now = new Date().toISOString()
  const item = toSessionTrack(input.track)
  const sessionId = input.mode === 'wave' ? ('wave' as const) : ('swipes' as const)
  const base = createEmptySessionQueueSnapshot(now)
  const queue =
    input.mode === 'wave'
      ? {
          ...base,
          items: [item],
          currentIndex: 0,
          playOrder: [0],
          playOrderIndex: 0,
          history: [item.id],
          historyIndex: 0,
          context: {
            type: 'radio' as const,
            id: 'my-wave' as const,
            title: 'Моя волна',
            origin: 'recommendations' as const,
          },
          sessionTailIds: [] as string[],
          positionSeconds: 0,
          phase: 'ready' as const,
          updatedAt: now,
        }
      : {
          ...base,
          items: [item],
          currentIndex: 0,
          playOrder: [0],
          playOrderIndex: 0,
          history: [item.id],
          historyIndex: 0,
          context: { type: 'swipe' as const },
          sessionTailIds: [] as string[],
          positionSeconds: 0,
          phase: 'ready' as const,
          updatedAt: now,
        }

  runtime.store.replaceSlot(sessionId, {
    meta: input.mode === 'wave' ? { kind: 'wave' } : { kind: 'swipes' },
    queue,
  })
  const imported = runtime.queue.importSessionState(
    sessionQueueToPlaybackQueueState(queue),
  )
  if (!imported.ok) {
    return { ok: false }
  }
  runtime.store.setActiveSessionId(sessionId)
  runtime.store.bumpSwitchEpoch()
  bindCmeOwnershipFromRuntime(sessionId)

  const userId = runtime.store.getUserId()
  if (userId) {
    try {
      runtime.persistence.saveSlot(
        userId,
        runtime.deviceId,
        runtime.store.getSlot(sessionId),
      )
      runtime.persistence.saveMeta(userId, runtime.deviceId, {
        activeSessionId: sessionId,
        switchEpoch: runtime.store.getSwitchEpoch(),
        playRequestId: runtime.store.getPlayRequestId(),
      })
    } catch {
      // best-effort
    }
  }
  return { ok: true }
}
