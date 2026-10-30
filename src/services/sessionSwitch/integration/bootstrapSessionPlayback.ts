/**
 * Порядок инициализации после подтверждённой авторизации (DEV-05):
 *
 * 1. Auth подтверждён (userId известен)
 * 2. getPlaybackQueue() singleton — единственная live-очередь
 * 3. prepareExistingLiveQueueForSessionMode (detach legacy, discard чужой queue)
 * 4. SessionStore bind userId/deviceId (без autoplay)
 * 5. AudioPlayer / PlayerManager уже живут на той же очереди (не создаём второй)
 * 6. SessionSwitchRuntime — только если feature flag ON
 *
 * Не вызывается из production bootstrap, пока flag выключен.
 */
import {
  getPlaybackQueue,
  type PlaybackQueue,
} from '../../playbackQueue/PlaybackQueue.ts'
import { prepareExistingLiveQueueForSessionMode } from '../migrateLiveQueue.ts'

export type AuthQueueHandoffInput = {
  userId: string
  deviceId: string
  /** Предыдущий userId в этом runtime (null = первый login / restore). */
  previousUserId: string | null
  /** По умолчанию — singleton getPlaybackQueue(). */
  liveQueue?: PlaybackQueue
}

export type AuthQueueHandoffResult = {
  persistenceMode: 'session'
  discardedUntrustedQueue: boolean
  /** true если очередь принадлежит другому аккаунту и была очищена. */
  isolatedFromPreviousUser: boolean
  queue: PlaybackQueue
}

/**
 * Безопасный handoff live-очереди после login / restore session.
 * Legacy v1 ключ не удаляется с диска, но отвязывается от runtime.
 */
export function handoffLiveQueueAfterAuth(
  input: AuthQueueHandoffInput,
): AuthQueueHandoffResult {
  const queue = input.liveQueue ?? getPlaybackQueue()
  const differentUser =
    input.previousUserId != null && input.previousUserId !== input.userId
  const untrusted =
    input.previousUserId == null || differentUser

  const prepared = prepareExistingLiveQueueForSessionMode(queue, {
    discardUntrustedLegacyQueue: untrusted,
  })

  return {
    persistenceMode: prepared.persistenceMode,
    discardedUntrustedQueue: prepared.discardedUntrustedQueue,
    isolatedFromPreviousUser: differentUser || prepared.discardedUntrustedQueue,
    queue,
  }
}

/**
 * Logout: отменить pending switch снаружи; очистить live queue от данных пользователя.
 * Не восстанавливает legacy v1 автоматически.
 */
export function teardownLiveQueueOnLogout(
  liveQueue: PlaybackQueue = getPlaybackQueue(),
): void {
  liveQueue.detachLegacyPersistence()
  liveQueue.clear()
}
