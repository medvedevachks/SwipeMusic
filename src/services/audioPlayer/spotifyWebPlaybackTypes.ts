/**
 * Минимальные типы Spotify Web Playback SDK.
 * @see https://developer.spotify.com/documentation/web-playback-sdk
 */

export type SpotifyWebPlaybackTrack = {
  uri: string
  id: string | null
  type: string
  name: string
  duration_ms?: number
}

export type SpotifyWebPlaybackState = {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: SpotifyWebPlaybackTrack
    previous_tracks: SpotifyWebPlaybackTrack[]
    next_tracks: SpotifyWebPlaybackTrack[]
  }
}

export type SpotifyWebPlaybackPlayer = {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(
    event: 'ready',
    cb: (data: { device_id: string }) => void,
  ): void
  addListener(
    event: 'not_ready',
    cb: (data: { device_id: string }) => void,
  ): void
  addListener(
    event: 'player_state_changed',
    cb: (state: SpotifyWebPlaybackState | null) => void,
  ): void
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (data: { message: string }) => void,
  ): void
  removeListener(event: string): void
  getCurrentState(): Promise<SpotifyWebPlaybackState | null>
  setName(name: string): Promise<void>
  getVolume(): Promise<number>
  setVolume(volume: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  togglePlay(): Promise<void>
  seek(positionMs: number): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  activateElement(): Promise<void>
}

export type SpotifyWebPlaybackNamespace = {
  Player: new (options: {
    name: string
    getOAuthToken: (cb: (token: string) => void) => void
    volume?: number
  }) => SpotifyWebPlaybackPlayer
}

declare global {
  interface Window {
    Spotify?: SpotifyWebPlaybackNamespace
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}
