import type {
  SpotifyPaging,
  SpotifyPlaylist,
  SpotifySavedTrackItem,
  SpotifyTrack,
  SpotifyUserProfile,
} from './types'

const API_BASE = 'https://api.spotify.com/v1'

export class SpotifyApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SpotifyApiError'
    this.status = status
  }
}

/** Ограничение Spotify (Free / app owner) — не сбой приложения. */
export function isPremiumRequiredError(error: unknown): boolean {
  if (!(error instanceof SpotifyApiError)) {
    return false
  }
  if (error.status !== 403) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    message.includes('premium') ||
    message.includes('subscription required') ||
    message.includes('active premium')
  )
}

export class SpotifyApiClient {
  private readonly getAccessToken: () => Promise<string>

  constructor(getAccessToken: () => Promise<string>) {
    this.getAccessToken = getAccessToken
  }
  async getMe(): Promise<SpotifyUserProfile> {
    return this.getJson<SpotifyUserProfile>('/me')
  }

  async searchTracks(
    query: string,
    options?: { limit?: number; offset?: number; signal?: AbortSignal },
  ): Promise<SpotifyPaging<SpotifyTrack>> {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0),
    })
    const data = await this.getJson<{ tracks: SpotifyPaging<SpotifyTrack> }>(
      `/search?${params.toString()}`,
      options?.signal,
    )
    return data.tracks
  }

  async getSavedTracks(options?: {
    limit?: number
    offset?: number
    signal?: AbortSignal
  }): Promise<SpotifyPaging<SpotifySavedTrackItem>> {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 50),
      offset: String(options?.offset ?? 0),
    })
    return this.getJson(`/me/tracks?${params.toString()}`, options?.signal)
  }

  async getPlaylists(options?: {
    limit?: number
    offset?: number
    signal?: AbortSignal
  }): Promise<SpotifyPaging<SpotifyPlaylist>> {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 50),
      offset: String(options?.offset ?? 0),
    })
    return this.getJson(`/me/playlists?${params.toString()}`, options?.signal)
  }

  async getPlaylistTracks(
    playlistId: string,
    options?: { limit?: number; offset?: number; signal?: AbortSignal },
  ): Promise<SpotifyPaging<{ track: SpotifyTrack | null }>> {
    const params = new URLSearchParams({
      limit: String(options?.limit ?? 50),
      offset: String(options?.offset ?? 0),
    })
    return this.getJson(
      `/playlists/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`,
      options?.signal,
    )
  }

  async getTrack(
    trackId: string,
    signal?: AbortSignal,
  ): Promise<SpotifyTrack> {
    return this.getJson(`/tracks/${encodeURIComponent(trackId)}`, signal)
  }

  /** Перенос playback на Web Playback device. */
  async transferPlayback(
    deviceId: string,
    play = false,
  ): Promise<void> {
    await this.putEmpty('/me/player', {
      device_ids: [deviceId],
      play,
    })
  }

  /** Старт / resume конкретного URI на device. */
  async startPlayback(options: {
    deviceId: string
    uris: string[]
    positionMs?: number
  }): Promise<void> {
    const params = new URLSearchParams({ device_id: options.deviceId })
    await this.putEmpty(`/me/player/play?${params.toString()}`, {
      uris: options.uris,
      position_ms: options.positionMs ?? 0,
    })
  }

  async pausePlayback(deviceId: string): Promise<void> {
    const params = new URLSearchParams({ device_id: deviceId })
    await this.putEmpty(`/me/player/pause?${params.toString()}`)
  }

  async seekPlayback(deviceId: string, positionMs: number): Promise<void> {
    const params = new URLSearchParams({
      device_id: deviceId,
      position_ms: String(Math.max(0, Math.floor(positionMs))),
    })
    await this.putEmpty(`/me/player/seek?${params.toString()}`)
  }

  async fetchAllSavedTracks(signal?: AbortSignal): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = []
    let offset = 0
    const limit = 50

    for (;;) {
      if (signal?.aborted) {
        break
      }
      const page = await this.getSavedTracks({ limit, offset, signal })
      for (const item of page.items) {
        if (item.track?.id) {
          tracks.push(item.track)
        }
      }
      if (!page.next || page.items.length === 0) {
        break
      }
      offset += limit
    }

    return tracks
  }

  async fetchAllPlaylists(
    signal?: AbortSignal,
  ): Promise<SpotifyPlaylist[]> {
    const playlists: SpotifyPlaylist[] = []
    let offset = 0
    const limit = 50

    for (;;) {
      if (signal?.aborted) {
        break
      }
      const page = await this.getPlaylists({ limit, offset, signal })
      playlists.push(...page.items)
      if (!page.next || page.items.length === 0) {
        break
      }
      offset += limit
    }

    return playlists
  }

  async fetchPlaylistTracks(
    playlistId: string,
    signal?: AbortSignal,
  ): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = []
    let offset = 0
    const limit = 50

    for (;;) {
      if (signal?.aborted) {
        break
      }
      const page = await this.getPlaylistTracks(playlistId, {
        limit,
        offset,
        signal,
      })
      for (const item of page.items) {
        if (item.track?.id) {
          tracks.push(item.track)
        }
      }
      if (!page.next || page.items.length === 0) {
        break
      }
      offset += limit
    }

    return tracks
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const token = await this.getAccessToken()
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new SpotifyApiError(
        `Spotify API ${response.status}: ${text}`,
        response.status,
      )
    }

    return (await response.json()) as T
  }

  private async putEmpty(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const token = await this.getAccessToken()
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new SpotifyApiError(
        `Spotify API ${response.status}: ${text}`,
        response.status,
      )
    }
  }
}
