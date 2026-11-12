/**
 * Подписка на live queue / player → durable flush (DEV-07).
 * Position — throttle; queue/pause/pagehide — immediate или короткий debounce.
 */
import type { AudioPlayer } from '../../audioPlayer/AudioPlayer.ts'
import type { PlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import {
  bumpFlushRevision,
  flushActiveSessionToStore,
  type FlushActiveSessionReason,
} from './flushActiveSession.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

const QUEUE_DEBOUNCE_MS = 80
const POSITION_THROTTLE_MS = 4000

export type ActiveSessionDurableSyncHandle = {
  stop: () => void
  flushNow: (reason?: FlushActiveSessionReason) => void
}

type SyncHost = {
  queue: PlaybackQueue
  player: Pick<
    AudioPlayer,
    'subscribe' | 'getState' | 'pause'
  >
}

let activeHandle: ActiveSessionDurableSyncHandle | null = null

export function stopActiveSessionDurableSync(): void {
  activeHandle?.stop()
  activeHandle = null
}

export function getActiveSessionDurableSyncForTests(): ActiveSessionDurableSyncHandle | null {
  return activeHandle
}

/**
 * Запустить sync для текущего SessionSwitchAppRuntime.
 * Идемпотентно: предыдущий handle останавливается.
 */
export function startActiveSessionDurableSync(
  host: SyncHost,
): ActiveSessionDurableSyncHandle {
  stopActiveSessionDurableSync()

  let stopped = false
  let queueTimer: ReturnType<typeof setTimeout> | null = null
  let lastPositionFlushAt = 0
  let lastPlaying: boolean | null = null
  let lastTrackId: string | null = null

  const clearQueueTimer = () => {
    if (queueTimer != null) {
      clearTimeout(queueTimer)
      queueTimer = null
    }
  }

  const runFlush = (
    reason: FlushActiveSessionReason,
    extras?: { positionOnly?: boolean },
  ) => {
    if (stopped) {
      return
    }
    const runtime = getSessionSwitchAppRuntime()
    if (!runtime || runtime.store.getActiveSessionId() == null) {
      return
    }
    const rev = bumpFlushRevision()
    const playing = host.player.getState().playing
    flushActiveSessionToStore({
      reason,
      expectedRevision: rev,
      positionOnly: extras?.positionOnly,
      playing,
    })
  }

  const scheduleQueueFlush = () => {
    if (stopped) {
      return
    }
    clearQueueTimer()
    const expected = bumpFlushRevision()
    queueTimer = setTimeout(() => {
      queueTimer = null
      if (stopped) {
        return
      }
      flushActiveSessionToStore({
        reason: 'queue',
        expectedRevision: expected,
        playing: host.player.getState().playing,
      })
    }, QUEUE_DEBOUNCE_MS)
  }

  const onQueue = () => {
    scheduleQueueFlush()
  }

  const unsubQueue = host.queue.subscribe(onQueue)

  const unsubPlayer = host.player.subscribe((state) => {
    if (stopped) {
      return
    }
    const trackId = state.currentTrack?.id ?? null
    const trackChanged = trackId !== lastTrackId
    const playingChanged =
      lastPlaying !== null && state.playing !== lastPlaying

    if (trackChanged) {
      lastTrackId = trackId
      runFlush('queue')
    } else if (playingChanged && !state.playing) {
      runFlush('pause')
    } else if (state.playing) {
      const now = Date.now()
      if (now - lastPositionFlushAt >= POSITION_THROTTLE_MS) {
        lastPositionFlushAt = now
        runFlush('position', { positionOnly: true })
      }
    }
    lastPlaying = state.playing
  })

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      bumpFlushRevision()
      runFlush('visibility')
    }
  }

  const onPageHide = () => {
    bumpFlushRevision()
    runFlush('pagehide')
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  const handle: ActiveSessionDurableSyncHandle = {
    stop() {
      if (stopped) {
        return
      }
      stopped = true
      clearQueueTimer()
      unsubQueue()
      unsubPlayer()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide)
      }
      if (activeHandle === handle) {
        activeHandle = null
      }
    },
    flushNow(reason: FlushActiveSessionReason = 'manual') {
      bumpFlushRevision()
      runFlush(reason)
    },
  }

  activeHandle = handle
  return handle
}
