import { createProviderStorage } from '../../../sdk/storage'
import type {
  AuthenticationProvider,
  ProviderStatusDescriptor,
} from '../../../sdk/types'
import { getPlayerManager } from '../../../services/audioPlayer'
import type { MusicSourceAdapter, SearchResult } from '../../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../../types'
import type { SourceType } from '../../../types/source'
import type { Track } from '../../../types/track'
import type { PlaybackCandidate } from '../../../services/playbackResolver'
import { indexTracksForSource } from '../../../services/mediaIndex'
import { SpotifyApiClient, SpotifyApiError, isPremiumRequiredError } from './api'
import {
  beginSpotifyLogin,
  clearSpotifyAuthCallbackFromUrl,
  exchangeSpotifyCode,
  isSpotifyConfigured,
  readSpotifyAuthCallback,
  refreshSpotifySession,
} from './auth'
import { mapSpotifyTrackToTrack } from './mapTrack'
import type { SpotifyAuthSession, SpotifySyncMeta } from './types'

const SOURCE_ID = 'spotify'
const SESSION_KEY = 'authSession'
const SYNC_KEY = 'syncMeta'
const PLAYLISTS_KEY = 'playlists'
const TRACKS_KEY = 'libraryTracks'

type PlaylistCache = Array<{ id: string; name: string; trackIds: string[] }>

/**
 * Полноценный Spotify Provider через Web API + PKCE.
 * Полный stream — Web Playback SDK; preview — через PlaybackResolver.
 */
export class SpotifyAdapter implements MusicSourceAdapter {
  readonly id = SOURCE_ID
  readonly label = 'Spotify'
  readonly type: SourceType = 'api'
  readonly kind: MusicSourceKind = 'official-api'
  readonly capabilities: readonly MusicSourceCapability[] = [
    'browse',
    'search',
    'library',
    'preview',
    'auth',
  ]
  readonly supportsSearch = true
  readonly supportsStreaming = true
  readonly supportsPagination = true

  private readonly storage = createProviderStorage(SOURCE_ID)
  private session: SpotifyAuthSession | null = null
  private tracks: Track[] = []
  private playlists: PlaylistCache = []
  private syncMeta: SpotifySyncMeta = {
    lastSyncedAt: null,
    trackCount: 0,
    playlistCount: 0,
    displayName: null,
  }
  private ready: Promise<void>
  private api: SpotifyApiClient

  constructor() {
    this.api = new SpotifyApiClient(() => this.getValidAccessToken())
    this.ready = this.hydrate()
  }

  async initialize(): Promise<void> {
    await this.ready
    await this.handleOAuthRedirectIfNeeded()
  }

  isAvailable(): boolean {
    // Сессия с refresh_token считается доступной — токен обновится лениво.
    return this.session != null
  }

  async dispose(): Promise<void> {}

  async fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult> {
    await this.ready
    if (!this.isAvailable()) {
      return { tracks: [], nextCursor: null }
    }
    if (this.tracks.length === 0) {
      await this.syncLibrary()
    }
    const limit = params?.limit ?? this.tracks.length
    const offset = params?.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0
    const slice = this.tracks.slice(offset, offset + limit)
    const nextOffset = offset + slice.length
    return {
      tracks: slice,
      nextCursor:
        nextOffset < this.tracks.length ? String(nextOffset) : null,
    }
  }

  async search(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult> {
    await this.ready
    if (!this.isAvailable()) {
      return { tracks: [], nextCursor: null }
    }

    const normalized = query.trim()
    if (!normalized) {
      return { tracks: [], nextCursor: null }
    }

    try {
      const page = await this.api.searchTracks(normalized, {
        limit: params?.limit ?? 20,
        signal: params?.signal,
      })
      return {
        tracks: page.items.map((item) => mapSpotifyTrackToTrack(item)),
        nextCursor: page.next ? String(page.offset + page.limit) : null,
      }
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 401) {
        await this.refreshOrClear()
      }
      throw error
    }
  }

  async getTrack(trackId: string): Promise<Track | null> {
    await this.ready
    const local =
      this.tracks.find(
        (track) => track.id === trackId || track.externalId === trackId,
      ) ?? null
    if (local) {
      return local
    }
    if (!this.isAvailable()) {
      return null
    }
    const externalId = trackId.startsWith(`${SOURCE_ID}:`)
      ? trackId.slice(SOURCE_ID.length + 1)
      : trackId
    try {
      const spotifyTrack = await this.api.getTrack(externalId)
      return mapSpotifyTrackToTrack(spotifyTrack)
    } catch {
      return null
    }
  }

  /**
   * URI для полного stream (Web Playback SDK).
   * Preview выбирает PlaybackResolver отдельным кандидатом.
   */
  async getStream(track: Track): Promise<string> {
    const externalId = track.externalId?.trim()
    if (!externalId) {
      throw new Error('Spotify: нет externalId трека')
    }
    if (externalId.startsWith('spotify:')) {
      return externalId
    }
    return `spotify:track:${externalId}`
  }

  async getPlaybackCandidates(track: Track): Promise<PlaybackCandidate[]> {
    await this.ready
    const externalId = track.externalId?.startsWith('spotify:')
      ? track.externalId
      : track.externalId
    const streamUri =
      externalId.startsWith('spotify:')
        ? externalId
        : `spotify:track:${externalId}`

    const premium = await this.isPremiumUser()
    const previewUrl = await this.resolvePreviewUrl(track)

    return [
      {
        id: 'spotify:stream',
        providerId: SOURCE_ID,
        type: 'stream',
        priority: 0,
        available: this.isAvailable() && premium,
        requiresPremium: true,
        url: premium ? streamUri : null,
        reason: premium
          ? undefined
          : 'Spotify Premium required for full playback',
        label: 'Full stream',
      },
      {
        id: 'spotify:preview',
        providerId: SOURCE_ID,
        type: 'preview',
        priority: 0,
        available: Boolean(previewUrl),
        url: previewUrl,
        reason: previewUrl ? undefined : 'No preview available',
        label: '30 sec preview',
      },
    ]
  }

  /** Access token для Web Playback SDK (без дублирования OAuth). */
  async resolveAccessToken(): Promise<string> {
    return this.getValidAccessToken()
  }

  getApiClient(): SpotifyApiClient {
    return this.api
  }

  private product: 'premium' | 'free' | 'unknown' = 'unknown'

  private async isPremiumUser(): Promise<boolean> {
    if (!this.isAvailable()) {
      return false
    }
    if (this.product === 'premium') {
      return true
    }
    if (this.product === 'free') {
      return false
    }
    try {
      const me = await this.api.getMe()
      this.product = me.product === 'premium' ? 'premium' : 'free'
      if (me.display_name || me.id) {
        this.syncMeta.displayName = me.display_name ?? me.id
        await this.persistSyncMeta()
      }
      return this.product === 'premium'
    } catch {
      this.product = 'unknown'
      return false
    }
  }

  private async resolvePreviewUrl(track: Track): Promise<string | null> {
    if (track.previewUrl) {
      return track.previewUrl
    }
    const cached = this.tracks.find(
      (item) =>
        item.id === track.id || item.externalId === track.externalId,
    )
    if (cached?.previewUrl) {
      return cached.previewUrl
    }
    if (!this.isAvailable()) {
      return null
    }
    try {
      const externalId = track.externalId.startsWith('spotify:')
        ? track.externalId.slice('spotify:track:'.length)
        : track.externalId
      const fresh = await this.api.getTrack(externalId)
      return fresh.preview_url
    } catch {
      return null
    }
  }

  async getCover(track: Track): Promise<string | undefined> {
    return track.coverUrl ?? undefined
  }

  private syncing = false

  createAuthenticationProvider(): AuthenticationProvider {
    return {
      isAuthenticated: async () => {
        await this.ready
        return this.isAvailable()
      },
      login: async () => {
        if (!isSpotifyConfigured()) {
          throw new Error('Provider is not configured')
        }
        await beginSpotifyLogin()
      },
      logout: async () => {
        await this.logout()
      },
      getStatus: async () => this.getConnectionStatus(),
      getProfile: async () => {
        await this.ready
        if (!this.syncMeta.displayName && this.isAvailable()) {
          try {
            const me = await this.api.getMe()
            this.syncMeta.displayName = me.display_name ?? me.id
            await this.persistSyncMeta()
          } catch {
            return null
          }
        }
        if (!this.syncMeta.displayName) {
          return null
        }
        return { displayName: this.syncMeta.displayName }
      },
      syncLibrary: async () => {
        this.syncing = true
        try {
          const count = await this.syncLibrary()
          return { trackCount: count }
        } finally {
          this.syncing = false
        }
      },
      getLastSyncedAt: async () => {
        await this.ready
        return this.syncMeta.lastSyncedAt
      },
    }
  }

  private async getConnectionStatus(): Promise<ProviderStatusDescriptor> {
    await this.ready
    const title = this.label

    if (!isSpotifyConfigured()) {
      if (import.meta.env.DEV) {
        return {
          status: 'not_configured',
          title,
          description: 'Spotify ещё не настроен.',
          severity: 'info',
          actions: [],
          setup: {
            title: 'Developer mode',
            description: 'Чтобы подключить источник:',
            steps: [
              {
                title:
                  'Создайте приложение в Spotify Developer Dashboard.',
              },
              { title: 'Получите Client ID.' },
              {
                title:
                  'Добавьте VITE_SPOTIFY_CLIENT_ID в конфигурацию приложения.',
              },
              { title: 'Перезапустите приложение.' },
            ],
            documentationUrl:
              'https://github.com/r-sh-galimov/SwipeMusic/blob/develop/docs/providers.md',
            documentationLabel: 'Open setup guide',
          },
        }
      }

      return {
        status: 'not_configured',
        title,
        description: 'Spotify currently unavailable',
        severity: 'neutral',
        actions: [],
      }
    }

    if (this.syncing) {
      return {
        status: 'syncing',
        title,
        description: 'Синхронизация…',
        severity: 'info',
        actions: [
          { id: 'logout', label: 'Disconnect', variant: 'danger' },
        ],
        details: this.buildSyncDetails(),
      }
    }

    if (!this.isAvailable()) {
      return {
        status: 'disconnected',
        title,
        description: 'Не подключён',
        severity: 'neutral',
        actions: [{ id: 'login', label: 'Connect', variant: 'primary' }],
        details: this.buildSyncDetails(),
      }
    }

    await this.refreshAccountTier()
    const premium = this.product === 'premium' && this.librarySyncAvailable

    if (!premium) {
      return {
        status: 'connected_free',
        title,
        description:
          'Spotify Free: синхронизация библиотеки недоступна. Доступно прослушивание 30-секундных preview.',
        severity: 'info',
        actions: [
          {
            id: 'sync',
            label: 'Синхронизировать библиотеку',
            variant: 'secondary',
            disabled: true,
            hint: 'Требуется Spotify Premium',
          },
          { id: 'logout', label: 'Disconnect', variant: 'danger' },
        ],
        details: [
          ...this.buildSyncDetails(),
          ...(this.syncMeta.displayName
            ? [{ label: 'Account', value: this.syncMeta.displayName }]
            : []),
        ],
      }
    }

    let deviceDetail: { label: string; value: string } | null = null
    const actions: ProviderStatusDescriptor['actions'] = [
      {
        id: 'sync',
        label: 'Синхронизировать библиотеку',
        variant: 'secondary',
      },
      { id: 'logout', label: 'Disconnect', variant: 'danger' },
    ]

    try {
      const prepared = await getPlayerManager().prepareDevice(SOURCE_ID)
      if (prepared) {
        deviceDetail = {
          label: 'Current Device',
          value:
            prepared.connected && prepared.deviceName
              ? prepared.deviceName
              : 'не активен',
        }
        actions.splice(1, 0, {
          id: 'reconnect_device',
          label: 'Reconnect device',
          variant: 'secondary',
        })
      }
    } catch {
      // Device опционален.
    }

    return {
      status: 'connected_premium',
      title,
      description: this.syncMeta.displayName
        ? `${title} Connected · ${this.syncMeta.displayName}`
        : `${title} Connected`,
      severity: 'success',
      actions,
      details: [
        ...this.buildSyncDetails(),
        ...(deviceDetail ? [deviceDetail] : []),
      ],
    }
  }

  private librarySyncAvailable = true

  private markLibrarySyncLimited(): void {
    this.product = 'free'
    this.librarySyncAvailable = false
    this.syncMeta = { ...this.syncMeta, librarySyncAvailable: false }
    void this.persistSyncMeta()
  }

  private async refreshAccountTier(): Promise<void> {
    if (!this.isAvailable()) {
      return
    }
    try {
      const me = await this.api.getMe()
      this.syncMeta.displayName = me.display_name ?? me.id
      if (me.product === 'premium') {
        // После оформления Premium / повторного Connect — снова разрешаем sync.
        this.product = 'premium'
        this.librarySyncAvailable = true
        this.syncMeta = { ...this.syncMeta, librarySyncAvailable: true }
      } else {
        this.markLibrarySyncLimited()
      }
      await this.persistSyncMeta()
    } catch {
      // оставляем текущий tier
    }
  }

  private buildSyncDetails(): Array<{ label: string; value: string }> {
    const value = this.syncMeta.lastSyncedAt
      ? new Date(this.syncMeta.lastSyncedAt).toLocaleString()
      : 'ещё не синхронизировано'
    return [{ label: 'Синхронизация', value }]
  }

  getPlaylists(): PlaylistCache {
    return [...this.playlists]
  }

  getSyncMeta(): SpotifySyncMeta {
    return { ...this.syncMeta }
  }

  async logout(): Promise<void> {
    this.session = null
    this.product = 'unknown'
    this.librarySyncAvailable = true
    this.tracks = []
    this.playlists = []
    this.syncMeta = {
      lastSyncedAt: null,
      trackCount: 0,
      playlistCount: 0,
      displayName: null,
    }
    await this.storage.remove(SESSION_KEY)
    await this.storage.remove(TRACKS_KEY)
    await this.storage.remove(PLAYLISTS_KEY)
    await this.storage.setJson(SYNC_KEY, this.syncMeta)
    await indexTracksForSource(SOURCE_ID, [])
  }

  /** Полная синхронизация library + playlists → MediaIndex. */
  async syncLibrary(signal?: AbortSignal): Promise<number> {
    await this.ready
    if (!this.isAvailable()) {
      throw new Error('Spotify не подключён')
    }

    try {
      const saved = await this.api.fetchAllSavedTracks(signal)
      const spotifyPlaylists = await this.api.fetchAllPlaylists(signal)

      const byId = new Map<string, Track>()
      for (const item of saved) {
        const track = mapSpotifyTrackToTrack(item, ['favorite', 'library'])
        byId.set(track.externalId, track)
      }

      const playlistCache: PlaylistCache = []
      for (const playlist of spotifyPlaylists) {
        if (signal?.aborted) {
          break
        }
        const playlistTracks = await this.api.fetchPlaylistTracks(
          playlist.id,
          signal,
        )
        const trackIds: string[] = []
        for (const item of playlistTracks) {
          trackIds.push(item.id)
          const existing = byId.get(item.id)
          const tag = `playlist:${playlist.id}`
          if (existing) {
            const tags = new Set([...(existing.tags ?? []), tag, 'library'])
            byId.set(item.id, { ...existing, tags: [...tags] })
          } else {
            byId.set(
              item.id,
              mapSpotifyTrackToTrack(item, [tag, 'library']),
            )
          }
        }
        playlistCache.push({
          id: playlist.id,
          name: playlist.name,
          trackIds,
        })
      }

      this.tracks = [...byId.values()]
      this.playlists = playlistCache
      this.product = 'premium'
      this.librarySyncAvailable = true
      this.syncMeta = {
        ...this.syncMeta,
        lastSyncedAt: new Date().toISOString(),
        trackCount: this.tracks.length,
        playlistCount: playlistCache.length,
        librarySyncAvailable: true,
      }

      await this.storage.setJson(TRACKS_KEY, this.tracks)
      await this.storage.setJson(PLAYLISTS_KEY, this.playlists)
      await this.persistSyncMeta()
      await indexTracksForSource(SOURCE_ID, this.tracks)

      return this.tracks.length
    } catch (error) {
      if (isPremiumRequiredError(error)) {
        // Ожидаемое ограничение Free / app owner — не ошибка приложения.
        this.markLibrarySyncLimited()
        return this.tracks.length
      }
      throw error
    }
  }

  private async hydrate(): Promise<void> {
    this.session = await this.storage.getJson<SpotifyAuthSession>(SESSION_KEY)
    this.tracks = (await this.storage.getJson<Track[]>(TRACKS_KEY)) ?? []
    this.playlists =
      (await this.storage.getJson<PlaylistCache>(PLAYLISTS_KEY)) ?? []
    this.syncMeta =
      (await this.storage.getJson<SpotifySyncMeta>(SYNC_KEY)) ?? this.syncMeta
    if (this.syncMeta.librarySyncAvailable === false) {
      this.librarySyncAvailable = false
      this.product = 'free'
    }

    if (this.session && this.session.expiresAt <= Date.now() + 60_000) {
      try {
        await this.refreshOrClear()
      } catch {
        this.session = null
      }
    }
  }

  private async handleOAuthRedirectIfNeeded(): Promise<void> {
    const { code, state, error } = readSpotifyAuthCallback()
    if (error) {
      clearSpotifyAuthCallbackFromUrl()
      throw new Error(`Spotify OAuth: ${error}`)
    }
    if (!code) {
      return
    }

    try {
      this.session = await exchangeSpotifyCode(code, state)
      await this.storage.setJson(SESSION_KEY, this.session)
      const me = await this.api.getMe()
      this.syncMeta.displayName = me.display_name ?? me.id
      if (me.product && me.product !== 'premium') {
        this.markLibrarySyncLimited()
      }
      await this.persistSyncMeta()
      // Free / Premium Required — syncLibrary сам помечает limited, не бросает.
      await this.syncLibrary()
    } finally {
      clearSpotifyAuthCallbackFromUrl()
    }
  }

  private async getValidAccessToken(): Promise<string> {
    await this.ready
    if (!this.session) {
      throw new Error('Spotify: нет сессии')
    }
    if (this.session.expiresAt <= Date.now() + 30_000) {
      await this.refreshOrClear()
    }
    if (!this.session) {
      throw new Error('Spotify: сессия истекла')
    }
    return this.session.accessToken
  }

  private async refreshOrClear(): Promise<void> {
    if (!this.session?.refreshToken) {
      await this.logout()
      return
    }
    try {
      this.session = await refreshSpotifySession(this.session.refreshToken)
      await this.storage.setJson(SESSION_KEY, this.session)
    } catch {
      await this.logout()
      throw new Error('Spotify: не удалось обновить токен')
    }
  }

  private async persistSyncMeta(): Promise<void> {
    await this.storage.setJson(SYNC_KEY, this.syncMeta)
  }
}

let shared: SpotifyAdapter | null = null

export function getSpotifyAdapter(): SpotifyAdapter {
  if (!shared) {
    shared = new SpotifyAdapter()
  }
  return shared
}

export function createSpotifyAdapter(): MusicSourceAdapter {
  return getSpotifyAdapter()
}
