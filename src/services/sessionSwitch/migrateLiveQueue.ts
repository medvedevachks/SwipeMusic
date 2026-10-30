/**
 * DEV-05: одна live-очередь = getPlaybackQueue() singleton.
 *
 * createSessionPlaybackQueue() создаёт ОТДЕЛЬНЫЙ экземпляр — его нельзя
 * подставлять параллельно с singleton, которым пользуется AudioPlayer.
 *
 * После авторизации используйте handoffLiveQueueAfterAuth()
 * (обёртка над prepareExistingLiveQueueForSessionMode).
 *
 * Production bootstrap не вызывает handoff, пока feature flag выключен.
 */
import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'

export type PrepareLiveQueueForSessionModeOptions = {
  /**
   * Если true — очистить in-memory очередь, ранее поднятую из legacy v1
   * без trusted userId. Legacy-ключ на диске НЕ удаляется.
   * Нужно после login другого аккаунта, чтобы не раскрыть чужую очередь.
   */
  discardUntrustedLegacyQueue?: boolean
}

export function prepareExistingLiveQueueForSessionMode(
  liveQueue: PlaybackQueue,
  options: PrepareLiveQueueForSessionModeOptions = {},
): {
  persistenceMode: 'session'
  discardedUntrustedQueue: boolean
} {
  liveQueue.detachLegacyPersistence()
  let discardedUntrustedQueue = false
  if (options.discardUntrustedLegacyQueue) {
    liveQueue.clear()
    discardedUntrustedQueue = true
  }
  return { persistenceMode: 'session', discardedUntrustedQueue }
}

/**
 * PLAYBACK-BUG-01 (исправлен в DEV-09): history хранит occurrence rank,
 * previous/peekPrevious резолвят через indexOfOccurrence, не findIndex.
 */
export const PLAYBACK_BUG_01 =
  'PLAYBACK-BUG-01: FIXED — historyRanks + occurrence rank for duplicate track ids'
