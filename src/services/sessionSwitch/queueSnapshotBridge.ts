import type { PlaybackQueueSessionState } from '../playbackQueue/PlaybackQueue.ts'
import { toSessionTrack } from '../playbackSession/sanitizeTrack.ts'
import type {
  SessionPlaybackPhase,
  SessionQueueSnapshot,
} from '../playbackSession/types.ts'
import type { RuntimePlaybackAnchor } from './ports.ts'

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
 * Durable-снимок для SessionStore (будущее восстановление).
 * Если playingId — pending-removal призрак, positionSeconds = 0
 * (не переносим позицию удалённого трека на следующую композицию).
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
  if (options.playingTrackId && pending.has(options.playingTrackId)) {
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

/**
 * Runtime-якорь для физического rollback: трек и позиция, которые
 * реально звучат (включая pending ghost). Не смешивать с durable.
 */
export function captureRuntimePlaybackAnchor(options: {
  playingTrackId: string | null
  positionSeconds: number
  pendingRemovalIds: readonly string[]
}): RuntimePlaybackAnchor {
  const pending = new Set(options.pendingRemovalIds)
  const trackId = options.playingTrackId
  const isPendingRemoval = Boolean(trackId && pending.has(trackId))
  const positionSeconds =
    Number.isFinite(options.positionSeconds) && options.positionSeconds >= 0
      ? options.positionSeconds
      : 0
  return {
    trackId,
    positionSeconds,
    isPendingRemoval,
  }
}
