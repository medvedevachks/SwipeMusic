/**
 * Будущее подключение (DEV-05): одна live-очередь = getPlaybackQueue() singleton.
 *
 * createSessionPlaybackQueue() создаёт ОТДЕЛЬНЫЙ экземпляр — его нельзя
 * подставлять параллельно с singleton, которым пользуется AudioPlayer.
 *
 * Безопасный путь после авторизации (вызывать на том же singleton):
 *   prepareExistingLiveQueueForSessionMode(getPlaybackQueue())
 *
 * DEV-04: эта функция НЕ вызывается из production playback path.
 */
import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'

export function prepareExistingLiveQueueForSessionMode(
  liveQueue: PlaybackQueue,
): { persistenceMode: 'session' } {
  liveQueue.detachLegacyPersistence()
  return { persistenceMode: 'session' }
}

/**
 * Зафиксированный дефект Previous при повторяющихся track ID.
 * Не смешивать с DEV-04; отдельная задача.
 */
export const PLAYBACK_BUG_01 =
  'PLAYBACK-BUG-01: previous() resolves history id via findIndex → first occurrence, not occurrence rank'
