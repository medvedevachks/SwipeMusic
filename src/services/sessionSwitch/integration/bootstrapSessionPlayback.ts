/**
 * Порядок инициализации после подтверждённой авторизации (DEV-05/05A):
 *
 * 1. Auth подтверждён (userId известен)
 * 2. getPlaybackQueue() singleton — единственная live-очередь
 * 3. prepareExistingLiveQueueForSessionMode (detach legacy, discard чужой queue)
 * 4. clearPlaybackIdentity на том же AudioPlayer (не второй экземпляр)
 * 5. SessionStore bind userId/deviceId (без autoplay)
 * 6. SessionSwitchRuntime — только если feature flag ON
 *
 * Не вызывается из production bootstrap, пока flag выключен.
 */
import {
  getPlaybackQueue,
  type PlaybackQueue,
} from '../../playbackQueue/PlaybackQueue.ts'
import { prepareExistingLiveQueueForSessionMode } from '../migrateLiveQueue.ts'

/** Минимальный порт сброса UI/physical identity (AudioPlayer.clearPlaybackIdentity). */
export type PlaybackIdentityClearPort = {
  clearPlaybackIdentity(): void
}

export type AuthQueueHandoffInput = {
  userId: string
  deviceId: string
  /** Предыдущий userId в этом runtime (null = первый login / restore). */
  previousUserId: string | null
  /** По умолчанию — singleton getPlaybackQueue(). */
  liveQueue?: PlaybackQueue
  /**
   * Тот же AudioPlayer, что обслуживает UI.
   * При untrusted/смене пользователя сбрасывает currentTrack предыдущего аккаунта.
   */
  player?: PlaybackIdentityClearPort
}

export type AuthQueueHandoffResult = {
  persistenceMode: 'session'
  discardedUntrustedQueue: boolean
  /** true если очередь принадлежит другому аккаунту и была очищена. */
  isolatedFromPreviousUser: boolean
  /** true если вызван clearPlaybackIdentity из-за untrusted handoff. */
  clearedPlayerIdentity: boolean
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

  let clearedPlayerIdentity = false
  if (untrusted && input.player) {
    input.player.clearPlaybackIdentity()
    clearedPlayerIdentity = true
  }

  return {
    persistenceMode: prepared.persistenceMode,
    discardedUntrustedQueue: prepared.discardedUntrustedQueue,
    isolatedFromPreviousUser: differentUser || prepared.discardedUntrustedQueue,
    clearedPlayerIdentity,
    queue,
  }
}

/**
 * Logout: отменить pending switch снаружи; очистить live queue и identity плеера.
 * Не восстанавливает legacy v1 автоматически. Не создаёт второй AudioPlayer.
 */
export function teardownLiveQueueOnLogout(
  liveQueue: PlaybackQueue = getPlaybackQueue(),
  player?: PlaybackIdentityClearPort,
): void {
  liveQueue.detachLegacyPersistence()
  liveQueue.clear()
  player?.clearPlaybackIdentity()
}
