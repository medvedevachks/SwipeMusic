import { useEffect } from 'react'
import { fetchSwipeFeed } from '../services/trackFeed'
import { bootstrapMusicSources } from '../sources'
import { usePlayerStore } from '../store/playerStore'

/** Заполняет очередь плеера на любом экране, не только на Home. */
export function usePlayerQueueBootstrap(): void {
  const queueLength = usePlayerStore((state) => state.queue.length)
  const setQueue = usePlayerStore((state) => state.setQueue)

  useEffect(() => {
    if (queueLength > 0) {
      return
    }

    let cancelled = false
    bootstrapMusicSources()

    void fetchSwipeFeed()
      .then((tracks) => {
        if (!cancelled && tracks.length > 0) {
          setQueue(tracks, 0)
        }
      })
      .catch(() => {
        // Ошибка фида обрабатывается на Home; здесь тихий fallback.
      })

    return () => {
      cancelled = true
    }
  }, [queueLength, setQueue])
}
