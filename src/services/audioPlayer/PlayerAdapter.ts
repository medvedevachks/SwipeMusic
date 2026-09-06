export type PlayerAdapterEventType =
  | 'play'
  | 'pause'
  | 'stop'
  | 'ended'
  | 'timeupdate'
  | 'loadedmetadata'
  | 'error'
  | 'volumechange'

export type PlayerAdapterEvent = {
  type: PlayerAdapterEventType
  currentTime: number
  duration: number
  volume: number
  error?: string
}

/**
 * Низкоуровневый адаптер воспроизведения.
 * HTMLAudioElement, Spotify Web Playback SDK и др. — взаимозаменяемы.
 */
export interface PlayerAdapter {
  load(url: string): Promise<void>
  play(): Promise<void>
  pause(): void
  stop(): void
  seek(timeSeconds: number): void
  setVolume(volume: number): void
  getCurrentTime(): number
  getDuration(): number
  getVolume(): number
  subscribe(listener: (event: PlayerAdapterEvent) => void): () => void
  dispose(): void
}
