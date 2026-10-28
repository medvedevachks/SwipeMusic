import type { PlaybackContext } from '../../types/playbackContext'
import type { Track } from '../../types/track'

export type AlbumPlaybackRef = {
  id: string
  title: string
  artist?: string
}

export type PlayAlbumInput = {
  tracks: Track[]
  startIndex: number
  album: AlbumPlaybackRef
}

export type PlayFromSwipeInput = {
  tracks: Track[]
  startIndex: number
  /**
   * Явный Play пользователя (кнопка «Слушать»).
   * Может сменить locked album/playlist context на swipe.
   * Gesture никогда не передаёт этот флаг.
   */
  explicitUserPlay?: boolean
}

/**
 * Обычный список Library (не album).
 * context по умолчанию — library; playlist/search допускаются без отдельных Intent API.
 */
export type PlayFromLibraryInput = {
  tracks: Track[]
  startIndex: number
  context?: Extract<
    PlaybackContext,
    { type: 'library' } | { type: 'playlist' } | { type: 'search' } | { type: 'none' }
  >
}

export type PlayFromQueueInput = {
  track: Track
}

/**
 * Явный Play одной композиции из поиска.
 * Выдача в очередь не копируется. Продолжение готовит ContinuationProvider.
 */
export type PlaySearchTrackInput = {
  track: Track
  query: string
  /** Исходная поисковая выдача — hard exclusions для рекомендаций. */
  searchHits?: readonly Track[]
}

export type PlayRadioInput = {
  tracks: Track[]
  startIndex: number
  origin: 'recommendations' | 'favorites'
}

export type ExitAlbumModeInput = {
  swipeTracks: Track[]
  /** pendingTrack ?? currentTrack — identity текущего playback. */
  currentTrack: Track | null
}
