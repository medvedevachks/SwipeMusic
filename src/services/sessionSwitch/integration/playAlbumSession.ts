/**
 * Play альбома через SessionSwitch (DEV-07).
 * Один ALBUM-слот на все альбомы; порядок = исходный порядок треков.
 */
import type { Track } from '../../../types/track.ts'
import {
  createEmptySessionQueueSnapshot,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import type { SessionQueueSnapshot } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type PlayAlbumSessionInput = {
  tracks: Track[]
  startIndex: number
  albumId: string
  albumTitle: string
  artist?: string
}

export type PlayAlbumSessionResult =
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

function buildAlbumQueueSnapshot(
  input: PlayAlbumSessionInput,
  startIndex: number,
): SessionQueueSnapshot {
  const now = new Date().toISOString()
  const items = input.tracks.map((t) => toSessionTrack(t))
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
      type: 'album',
      id: input.albumId,
      title: input.albumTitle,
      ...(input.artist ? { artist: input.artist } : {}),
    },
    sessionTailIds: [],
    positionSeconds: 0,
    phase: 'playing',
    updatedAt: now,
  }
}

/**
 * Запуск другого альбома заменяет только ALBUM-слот.
 * Недоступные треки: Prepare fail → coordinator rollback, другие сессии целы.
 */
export async function playAlbumViaSessionSwitch(
  input: PlayAlbumSessionInput,
): Promise<PlayAlbumSessionResult> {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { ok: false, reason: 'flag_off' }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { ok: false, reason: 'no_runtime' }
  }
  if (input.tracks.length === 0) {
    return { ok: false, reason: 'empty', message: 'empty album' }
  }

  const startIndex = Math.min(
    Math.max(0, input.startIndex),
    input.tracks.length - 1,
  )
  const startTrack = input.tracks[startIndex]!
  const targetQueue = buildAlbumQueueSnapshot(input, startIndex)

  const result = await runtime.coordinator.switchTo({
    target: 'album',
    meta: {
      kind: 'album',
      albumId: input.albumId,
      title: input.albumTitle,
      ...(input.artist ? { artist: input.artist } : {}),
      phase: 'album',
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

export function isAlbumSessionPlaybackActive(): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return false
  }
  return getSessionSwitchAppRuntime()?.store.getActiveSessionId() === 'album'
}
