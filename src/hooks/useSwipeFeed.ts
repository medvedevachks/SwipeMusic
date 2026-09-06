import { useEffect, useState } from 'react'
import { fetchSwipeFeed } from '../services/trackFeed'
import { bootstrapMusicSources } from '../sources'
import { useLocalMusicStore } from '../store/localMusicStore'
import { useSourceManagerStore } from '../store/sourceManagerStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import type { Track } from '../types/track'

type UseSwipeFeedResult = {
  tracks: Track[]
  isLoading: boolean
  error: string | null
  mode: 'catalog' | 'search'
  searchQuery: string | null
}

/**
 * Источник колоды для Home.
 * Если Search применил сессию — отдаём её Track[]; иначе каталог как раньше.
 */
export function useSwipeFeed(): UseSwipeFeedResult {
  const sessionMode = useSwipeDeckSessionStore((state) => state.mode)
  const sessionTracks = useSwipeDeckSessionStore((state) => state.tracks)
  const searchQuery = useSwipeDeckSessionStore((state) => state.searchQuery)
  const enabledSourceKey = useSourceManagerStore((state) =>
    state.sources
      .filter((source) => source.enabled)
      .map((source) => source.id)
      .join(','),
  )
  const libraryGeneration = useLocalMusicStore(
    (state) => state.libraryGeneration,
  )

  const [catalogTracks, setCatalogTracks] = useState<Track[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionMode === 'search') {
      return
    }

    let cancelled = false
    bootstrapMusicSources()

    void fetchSwipeFeed()
      .then((feed) => {
        if (!cancelled) {
          setCatalogTracks(feed)
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
  }, [sessionMode, enabledSourceKey, libraryGeneration])

  if (sessionMode === 'search' && sessionTracks) {
    return {
      tracks: sessionTracks,
      isLoading: false,
      error: null,
      mode: 'search',
      searchQuery,
    }
  }

  return {
    tracks: catalogTracks,
    isLoading,
    error,
    mode: 'catalog',
    searchQuery: null,
  }
}
