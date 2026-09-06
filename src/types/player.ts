import type { Track } from './track'

/**
 * Состояние плеера для UI / store.
 * React читает только это — без доступа к HTMLAudioElement.
 */
export type PlayerState = {
  currentTrack: Track | null
  playing: boolean
  paused: boolean
  currentTime: number
  duration: number
  volume: number
  queue: Track[]
  queueIndex: number
  error: string | null
}

export const initialPlayerState: PlayerState = {
  currentTrack: null,
  playing: false,
  paused: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  queue: [],
  queueIndex: -1,
  error: null,
}
