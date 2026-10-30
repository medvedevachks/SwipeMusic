/**
 * Восстановление последней active-сессии без autoplay (DEV-07).
 * Live queue + paused identity в мини-плеере; physical play не вызывается.
 */
import type { PlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import type { PlaybackSessionStore } from '../../playbackSession/PlaybackSessionStore.ts'
import type { PlaybackSessionId } from '../../playbackSession/types.ts'
import type { Track } from '../../../types/track.ts'
import {
  sessionQueueToPlaybackQueueState,
} from '../queueSnapshotBridge.ts'
import { sessionTrackAsTrack } from './sessionTrackAsTrack.ts'

export type RestorePausedIdentityPort = {
  restorePausedIdentity(
    track: Track | null,
    positionSeconds: number,
  ): void
}

export type RestoreActiveSessionResult = {
  restored: boolean
  sessionId: PlaybackSessionId | null
  audioAutoplay: false
}

/**
 * Если у hydrated active slot есть треки — импорт в live queue + paused UI.
 * Иначе active остаётся null.
 */
export function restoreActiveSessionWithoutAutoplay(options: {
  store: PlaybackSessionStore
  queue: PlaybackQueue
  player: RestorePausedIdentityPort
  /** active из persistence до намеренного null. */
  hydratedActiveSessionId: PlaybackSessionId | null
}): RestoreActiveSessionResult {
  const sessionId = options.hydratedActiveSessionId
  if (!sessionId) {
    options.store.setActiveSessionId(null)
    return { restored: false, sessionId: null, audioAutoplay: false }
  }

  const slot = options.store.getSlot(sessionId)
  if (slot.queue.items.length === 0 || slot.queue.currentIndex < 0) {
    options.store.setActiveSessionId(null)
    return { restored: false, sessionId: null, audioAutoplay: false }
  }

  const imported = options.queue.importSessionState(
    sessionQueueToPlaybackQueueState(slot.queue),
  )
  if (!imported.ok) {
    options.store.setActiveSessionId(null)
    return { restored: false, sessionId: null, audioAutoplay: false }
  }

  const current =
    slot.queue.currentIndex >= 0
      ? slot.queue.items[slot.queue.currentIndex]
      : null
  const track = current ? sessionTrackAsTrack(current) : null
  const position = Math.max(0, slot.queue.positionSeconds || 0)
  options.player.restorePausedIdentity(track, position)
  options.store.setActiveSessionId(sessionId)

  return { restored: true, sessionId, audioAutoplay: false }
}
