/**
 * Play выбранного трека из поиска через SessionSwitch (DEV-07).
 * SEARCH — отдельный слот; очередь = один seed + hardExcludeHits в context.
 */
import type { Track } from '../../../types/track.ts'
import { buildSearchHitExclusions } from '../../continuation/searchSeedPlayback.ts'
import {
  createEmptySessionQueueSnapshot,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import type { SessionQueueSnapshot } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { bindCmeOwnershipFromRuntime } from './cmeSessionOwnership.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type PlaySearchSessionInput = {
  track: Track
  query: string
  searchHits?: readonly Track[]
}

export type PlaySearchSessionResult =
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

function buildSearchQueueSnapshot(input: PlaySearchSessionInput): SessionQueueSnapshot {
  const now = new Date().toISOString()
  const hits =
    input.searchHits && input.searchHits.length > 0
      ? input.searchHits
      : [input.track]
  const hardExcludeHits = buildSearchHitExclusions(hits)
  const item = toSessionTrack(input.track)
  return {
    ...createEmptySessionQueueSnapshot(now),
    items: [item],
    currentIndex: 0,
    playOrder: [0],
    playOrderIndex: 0,
    history: [item.id],
    historyIndex: 0,
    context: {
      type: 'search-seed',
      query: input.query,
      seedTrackId: input.track.id,
      hardExcludeHits,
    },
    sessionTailIds: [],
    positionSeconds: 0,
    phase: 'playing',
    updatedAt: now,
  }
}

/**
 * Новый Play из поиска заменяет только SEARCH-слот.
 * Не копирует выдачу в последовательную очередь.
 */
export async function playSearchViaSessionSwitch(
  input: PlaySearchSessionInput,
): Promise<PlaySearchSessionResult> {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { ok: false, reason: 'flag_off' }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { ok: false, reason: 'no_runtime' }
  }
  if (!input.track?.id) {
    return { ok: false, reason: 'empty', message: 'empty search track' }
  }

  const targetQueue = buildSearchQueueSnapshot(input)
  const result = await runtime.coordinator.switchTo({
    target: 'search',
    meta: {
      kind: 'search',
      query: input.query,
      seedTrackId: input.track.id,
    },
    targetQueue,
    startTrackId: input.track.id,
  })

  if (result.ok) {
    bindCmeOwnershipFromRuntime('search')
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

export function isSearchSessionPlaybackActive(): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return false
  }
  return getSessionSwitchAppRuntime()?.store.getActiveSessionId() === 'search'
}
