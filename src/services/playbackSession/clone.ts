import { clonePlaybackContext } from './cloneContext.ts'
import { toSessionTracks } from './sanitizeTrack.ts'
import type {
  PlaybackSessionId,
  PlaybackSessionSlot,
  SessionQueueSnapshot,
  SessionSlotMeta,
} from './types.ts'

export function cloneMeta(meta: SessionSlotMeta): SessionSlotMeta {
  switch (meta.kind) {
    case 'swipes':
      return { kind: 'swipes' }
    case 'wave':
      return { kind: 'wave' }
    case 'search':
      return {
        kind: 'search',
        query: meta.query,
        seedTrackId: meta.seedTrackId,
      }
    case 'catalog':
      return {
        kind: 'catalog',
        catalogId: meta.catalogId,
        title: meta.title,
      }
    case 'album':
      return {
        kind: 'album',
        albumId: meta.albumId,
        title: meta.title,
        ...(meta.artist !== undefined ? { artist: meta.artist } : {}),
        phase: meta.phase,
      }
    default: {
      const _exhaustive: never = meta
      return _exhaustive
    }
  }
}

export function cloneSessionQueueSnapshot(
  queue: SessionQueueSnapshot,
): SessionQueueSnapshot {
  return {
    items: toSessionTracks(queue.items),
    currentIndex: queue.currentIndex,
    playOrder: [...queue.playOrder],
    playOrderIndex: queue.playOrderIndex,
    repeatMode: queue.repeatMode,
    shuffleMode: queue.shuffleMode,
    history: [...queue.history],
    historyIndex: queue.historyIndex,
    context: clonePlaybackContext(queue.context),
    sessionTailIds: [...queue.sessionTailIds],
    positionSeconds: queue.positionSeconds,
    phase: queue.phase,
    updatedAt: queue.updatedAt,
  }
}

export function clonePlaybackSessionSlot(slot: PlaybackSessionSlot): PlaybackSessionSlot {
  return {
    id: slot.id,
    meta: cloneMeta(slot.meta),
    queue: cloneSessionQueueSnapshot(slot.queue),
    slotGeneration: slot.slotGeneration,
  }
}

export function isMetaCompatibleWithSession(
  sessionId: PlaybackSessionId,
  meta: SessionSlotMeta,
): boolean {
  return meta.kind === sessionId
}
