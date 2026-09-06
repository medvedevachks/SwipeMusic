/** Spotify Web API типы (минимальный набор). */

export type SpotifyImage = {
  url: string
  height: number | null
  width: number | null
}

export type SpotifyArtistRef = {
  id: string
  name: string
}

export type SpotifyAlbumRef = {
  id: string
  name: string
  images?: SpotifyImage[]
  release_date?: string
}

export type SpotifyTrack = {
  id: string
  name: string
  duration_ms: number
  preview_url: string | null
  artists: SpotifyArtistRef[]
  album: SpotifyAlbumRef
  external_ids?: { isrc?: string }
  explicit?: boolean
}

export type SpotifySavedTrackItem = {
  added_at: string
  track: SpotifyTrack
}

export type SpotifyPlaylist = {
  id: string
  name: string
  tracks: { total: number }
  images?: SpotifyImage[]
  owner?: { display_name?: string }
}

export type SpotifyPaging<T> = {
  items: T[]
  next: string | null
  total: number
  limit: number
  offset: number
}

export type SpotifyTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

export type SpotifyUserProfile = {
  id: string
  display_name: string | null
  email?: string
  images?: SpotifyImage[]
  /** 'premium' | 'free' | 'open' — для PlaybackResolver. */
  product?: string
}

export type SpotifyAuthSession = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scope: string
}

export type SpotifySyncMeta = {
  lastSyncedAt: string | null
  trackCount: number
  playlistCount: number
  displayName: string | null
  /** false после Premium Required на sync — не ошибка, ограничение Free. */
  librarySyncAvailable?: boolean
}

export const SPOTIFY_SCOPES = [
  'user-read-email',
  'user-read-private',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-top-read',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ')
