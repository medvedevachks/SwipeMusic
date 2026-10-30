import type { PlaybackQueueSessionState } from '../playbackQueue/PlaybackQueue.ts'
import { toSessionTrack } from '../playbackSession/sanitizeTrack.ts'
import type {
  SessionPlaybackPhase,
  SessionQueueSnapshot,
} from '../playbackSession/types.ts'

export function sessionQueueToPlaybackQueueState(
  queue: SessionQueueSnapshot,
): PlaybackQueueSessionState {
  return {
    items: queue.items.map((item) => ({ ...item, previewUrl: null })),
    currentIndex: queue.currentIndex,
    playOrder: [...queue.playOrder],
    playOrderIndex: queue.playOrderIndex,
    repeatMode: queue.repeatMode,
    shuffleMode: queue.shuffleMode,
    history: [...queue.history],
    historyIndex: queue.historyIndex,
    context: queue.context,
    sessionTailIds: [...queue.sessionTailIds],
  }
}

/**
 * Durable-снимок live queue + позиция.
 * Если playingId — pending-removal призрак, positionSeconds принудительно 0
 * (не переносим позицию удалённого трека на следующую композицию снимка).
 */
export function playbackExportToSessionQueue(
  exported: PlaybackQueueSessionState,
  options: {
    positionSeconds: number
    playingTrackId: string | null
    pendingRemovalIds: readonly string[]
    phase: SessionPlaybackPhase
    updatedAt: string
  },
): SessionQueueSnapshot {
  const pending = new Set(options.pendingRemovalIds)
  const durableCurrentId =
    exported.currentIndex >= 0
      ? (exported.items[exported.currentIndex]?.id ?? null)
      : null

  let positionSeconds = options.positionSeconds
  if (
    options.playingTrackId &&
    pending.has(options.playingTrackId)
  ) {
    positionSeconds = 0
  } else if (
    durableCurrentId &&
    options.playingTrackId &&
    durableCurrentId !== options.playingTrackId
  ) {
    positionSeconds = 0
  } else if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    positionSeconds = 0
  }

  return {
    items: exported.items.map((item) => toSessionTrack(item)),
    currentIndex: exported.currentIndex,
    playOrder: [...exported.playOrder],
    playOrderIndex: exported.playOrderIndex,
    repeatMode: exported.repeatMode,
    shuffleMode: exported.shuffleMode,
    history: [...exported.history],
    historyIndex: exported.historyIndex,
    context: exported.context,
    sessionTailIds: [...exported.sessionTailIds],
    positionSeconds,
    phase: options.phase,
    updatedAt: options.updatedAt,
  }
}
