import { useEffect, useState } from 'react'
import { fetchSwipeFeed } from '../services/trackFeed'
import { bootstrapMusicSources } from '../sources'
import type { Track } from '../types/track'

type UseSwipeFeedResult = {
  tracks: Track[]
  isLoading: boolean
  error: string | null
}

export function useSwipeFeed(): UseSwipeFeedResult {
  const [tracks, setTracks] = useState<Track[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    bootstrapMusicSources()

    void fetchSwipeFeed()
      .then((feed) => {
        if (!cancelled) {
          setTracks(feed)
          setError(null)
          setIsLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load tracks')
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { tracks, isLoading, error }
}
