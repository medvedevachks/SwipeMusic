/**
 * Будущее подключение (DEV-05): одна live-очередь = getPlaybackQueue() singleton.
 *
 * createSessionPlaybackQueue() создаёт ОТДЕЛЬНЫЙ экземпляр — его нельзя
 * подставлять параллельно с singleton, которым пользуется AudioPlayer.
 *
 * Безопасный путь после авторизации (вызывать на том же singleton):
 *   prepareExistingLiveQueueForSessionMode(getPlaybackQueue(), {
 *     discardUntrustedLegacyQueue: true,
 *   })
 *
 * Не вызывается из production bootstrap в DEV-04/04A.
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
 * Зафиксированный дефект Previous при повторяющихся track ID.
 * Не смешивать с DEV-04; отдельная задача.
 */
export const PLAYBACK_BUG_01 =
  'PLAYBACK-BUG-01: previous() resolves history id via findIndex → first occurrence, not occurrence rank'
