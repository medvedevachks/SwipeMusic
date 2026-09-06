import { usePlayerStore } from '../store/playerStore'

/**
 * Восстанавливает очередь из PlaybackQueue (localStorage).
 * Не затирает сохранённую очередь демо-фидом.
 */
export function usePlayerQueueBootstrap(): void {
  const queueLength = usePlayerStore((state) => state.queue.length)
  const currentTrack = usePlayerStore((state) => state.currentTrack)

  // Подписка на store уже гидрирует queue из PlaybackQueue при старте AudioPlayer.
  void queueLength
  void currentTrack
}
