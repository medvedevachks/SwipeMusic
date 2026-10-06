import { createProviderStorage } from '../../../sdk/storage'
import type {
  AuthenticationProvider,
  ProviderStatusDescriptor,
} from '../../../sdk/types'
import { indexTracksForSource } from '../../../services/mediaIndex'
import type { PlaybackCandidate } from '../../../services/playbackResolver'
import type { MusicSourceAdapter, SearchResult } from '../../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../../types'
import type { SourceType } from '../../../types/source'
import type { Track } from '../../../types/track'
import { YandexMusicApiClient, YandexApiError } from './api'
import { runYandexDeviceAuth } from './auth'
import { pushYandexDevLog } from './devLog'
import { mapYandexTrackToTrack } from './mapTrack'
import { buildYandexPlaybackCandidates } from './playbackCandidates'
import type {
  YandexAuthSession,
  YandexDeviceCode,
  YandexSyncMeta,
} from './types'

const SOURCE_ID = 'yandex-music'
const SESSION_KEY = 'authSession'
const SYNC_KEY = 'syncMeta'
const PLAYLISTS_KEY = 'playlists'
const TRACKS_KEY = 'libraryTracks'

type PlaylistCache = Array<{ id: string; name: string; trackIds: string[] }>

/**
 * Яндекс Музыка через внутренний API (experimental).
 * Plugin-first: Search / Library / Auth / PlaybackCandidate.
 */
export class YandexMusicAdapter implements MusicSourceAdapter {
  readonly id = SOURCE_ID
  readonly label = 'Яндекс Музыка'
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
  private session: YandexAuthSession | null = null
  private tracks: Track[] = []
  private playlists: PlaylistCache = []
  private syncMeta: YandexSyncMeta = {
    lastSyncedAt: null,
    trackCount: 0,
    playlistCount: 0,
    displayName: null,
    uid: null,
    hasPlus: false,
  }
  private ready: Promise<void>
  private api: YandexMusicApiClient
  private syncing = false
  private pendingDevice: YandexDeviceCode | null = null
  private authAbort: AbortController | null = null

  constructor() {
    this.api = new YandexMusicApiClient(() => this.getValidAccessToken())
    this.ready = this.hydrate()
  }

  async initialize(): Promise<void> {
    await this.ready
    pushYandexDevLog({
      stage: 'register',
      message: 'YandexMusicAdapter initialized',
      detail: 'experimental internal API',
    })
  }

  isAvailable(): boolean {
    return this.session != null && Boolean(this.session.accessToken)
  }

  async dispose(): Promise<void> {
    this.authAbort?.abort()
  }

  async fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult> {
    await this.ready
    if (!this.isAvailable()) {
      return { tracks: [], nextCursor: null }
    }
    if (this.tracks.length === 0) {
      await this.syncLibrary(params?.signal)
    }
    const offset = params?.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0
    const limit = params?.limit ?? 50
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
        page: params?.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0,
        signal: params?.signal,
      })
      const tracks = page.tracks.map((item) => mapYandexTrackToTrack(item))
      pushYandexDevLog({
        stage: 'search',
        message: `Tracks received: ${tracks.length}`,
      })
      const nextPage =
        page.tracks.length > 0 ? String((params?.cursor ? Number(params.cursor) : 0) + 1) : null
      return { tracks, nextCursor: nextPage }
    } catch (error) {
      pushYandexDevLog({
        stage: 'error',
        message: 'search failed',
        detail: error instanceof Error ? error.message : String(error),
      })
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
      const rows = await this.api.getTracksByIds(externalId)
      const row = rows[0]
      return row ? mapYandexTrackToTrack(row) : null
    } catch {
      return null
    }
  }

  async getStream(track: Track): Promise<string> {
    await this.ready
    if (!this.isAvailable()) {
      throw new Error('Yandex Music: нет сессии')
    }
    const url = await this.api.resolveDirectStreamUrl(track.externalId)
    if (!url) {
      if (track.previewUrl) {
        return track.previewUrl
      }
      throw new Error('Yandex Music: stream URL недоступен')
    }
    return url
  }

  async getCover(track: Track): Promise<string | undefined> {
    return track.coverUrl ?? undefined
  }

  async getPlaybackCandidates(track: Track): Promise<PlaybackCandidate[]> {
    await this.ready
    return buildYandexPlaybackCandidates(track, {
      api: this.isAvailable() ? this.api : null,
      authenticated: this.isAvailable(),
      hasPlus: this.syncMeta.hasPlus,
    })
  }

  getPlaylists(): PlaylistCache {
    return this.playlists
  }

  createAuthenticationProvider(): AuthenticationProvider {
    return {
      isAuthenticated: async () => {
        await this.ready
        return this.isAvailable()
      },
      login: async () => {
        await this.beginLogin()
      },
      logout: async () => {
        await this.logout()
      },
      getStatus: async () => this.getConnectionStatus(),
      getProfile: async () => {
        await this.ready
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

  private async beginLogin(): Promise<void> {
    this.authAbort?.abort()
    this.authAbort = new AbortController()
    pushYandexDevLog({ stage: 'auth', message: 'login started (device flow)' })

    try {
      const session = await runYandexDeviceAuth({
        signal: this.authAbort.signal,
        onCode: (code) => {
          this.pendingDevice = code
          void navigator.clipboard.writeText(code.userCode).catch(() => undefined)
          window.open(code.verificationUrl, '_blank', 'noopener,noreferrer')
        },
      })

      this.session = session
      this.pendingDevice = null
      await this.storage.setJson(SESSION_KEY, session)
      await this.refreshAccount()
      pushYandexDevLog({
        stage: 'auth',
        message: 'login success',
        detail: this.syncMeta.displayName ?? undefined,
      })
      const { platformEventBus } = await import('../../../sdk/EventBus')
      platformEventBus.emit('SourceAuthenticated', { sourceId: SOURCE_ID })
    } catch (error) {
      this.pendingDevice = null
      throw error
    }
  }

  private async logout(): Promise<void> {
    this.authAbort?.abort()
    this.session = null
    this.pendingDevice = null
    this.tracks = []
    this.playlists = []
    this.syncMeta = {
      lastSyncedAt: null,
      trackCount: 0,
      playlistCount: 0,
      displayName: null,
      uid: null,
      hasPlus: false,
    }
    await this.storage.remove(SESSION_KEY)
    await this.storage.remove(SYNC_KEY)
    await this.storage.remove(PLAYLISTS_KEY)
    await this.storage.remove(TRACKS_KEY)
    pushYandexDevLog({ stage: 'auth', message: 'logout' })
  }

  private async getConnectionStatus(): Promise<ProviderStatusDescriptor> {
    await this.ready
    const title = this.label

    if (this.pendingDevice) {
      return {
        status: 'syncing',
        title,
        description: `Подтвердите вход: код ${this.pendingDevice.userCode}`,
        severity: 'info',
        actions: [{ id: 'logout', label: 'Cancel', variant: 'danger' }],
        details: [
          { label: 'Code', value: this.pendingDevice.userCode },
          { label: 'URL', value: this.pendingDevice.verificationUrl },
        ],
      }
    }

    if (!this.isAvailable()) {
      return {
        status: 'disconnected',
        title,
        description:
          'Войдите через OAuth Device Flow (experimental internal API).',
        severity: 'neutral',
        actions: [{ id: 'login', label: 'Connect', variant: 'primary' }],
        setup: {
          title: 'Experimental provider',
          description:
            'Используется внутренний API Яндекс Музыки. После Connect откроется страница Яндекса — введите код устройства.',
          steps: [
            { title: 'Нажмите Connect' },
            {
              title: 'Откройте verification URL и введите код',
            },
            { title: 'Дождитесь завершения входа в приложении' },
          ],
        },
      }
    }

    if (this.syncing) {
      return {
        status: 'syncing',
        title,
        description: 'Синхронизация библиотеки…',
        severity: 'info',
        actions: [],
      }
    }

    return {
      status: this.syncMeta.hasPlus ? 'connected_premium' : 'connected_free',
      title,
      description: this.syncMeta.displayName
        ? `Connected · ${this.syncMeta.displayName}`
        : 'Connected',
      severity: 'success',
      actions: [
        {
          id: 'sync',
          label: 'Синхронизировать библиотеку',
          variant: 'secondary',
        },
        { id: 'logout', label: 'Disconnect', variant: 'danger' },
      ],
      details: [
        {
          label: 'Plus',
          value: this.syncMeta.hasPlus ? 'yes' : 'no',
        },
        {
          label: 'Tracks',
          value: String(this.syncMeta.trackCount),
        },
        ...(this.syncMeta.lastSyncedAt
          ? [
              {
                label: 'Sync',
                value: new Date(this.syncMeta.lastSyncedAt).toLocaleString(),
              },
            ]
          : []),
      ],
    }
  }

  async syncLibrary(signal?: AbortSignal): Promise<number> {
    await this.ready
    if (!this.isAvailable() || this.syncMeta.uid == null) {
      await this.refreshAccount(signal)
    }
    if (!this.isAvailable() || this.syncMeta.uid == null) {
      return 0
    }

    pushYandexDevLog({
      stage: 'library',
      message: 'syncLibrary started',
    })

    const liked = await this.api.getLikedTracks(this.syncMeta.uid, signal)
    const likedTracks = liked.map((item) =>
      mapYandexTrackToTrack(item, ['favorite']),
    )

    const playlistsRaw = await this.api.getPlaylists(this.syncMeta.uid, signal)
    const playlistCache: PlaylistCache = []
    const byId = new Map<string, Track>()
    for (const track of likedTracks) {
      byId.set(track.id, track)
    }

    for (const playlist of playlistsRaw.slice(0, 30)) {
      try {
        const rows = await this.api.getPlaylistTracks(
          this.syncMeta.uid,
          playlist.kind,
          signal,
        )
        const trackIds: string[] = []
        for (const row of rows) {
          const mapped = mapYandexTrackToTrack(row)
          trackIds.push(mapped.id)
          if (!byId.has(mapped.id)) {
            byId.set(mapped.id, mapped)
          }
        }
        playlistCache.push({
          id: String(playlist.kind),
          name: playlist.title,
          trackIds,
        })
      } catch (error) {
        pushYandexDevLog({
          stage: 'error',
          message: 'playlist sync failed',
          detail:
            error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.tracks = [...byId.values()]
    this.playlists = playlistCache
    this.syncMeta = {
      ...this.syncMeta,
      lastSyncedAt: new Date().toISOString(),
      trackCount: this.tracks.length,
      playlistCount: this.playlists.length,
    }

    await this.storage.setJson(TRACKS_KEY, this.tracks)
    await this.storage.setJson(PLAYLISTS_KEY, this.playlists)
    await this.storage.setJson(SYNC_KEY, this.syncMeta)

    await indexTracksForSource(SOURCE_ID, this.tracks)

    pushYandexDevLog({
      stage: 'library',
      message: 'syncLibrary done',
      detail: `tracks=${this.tracks.length}`,
    })

    return this.tracks.length
  }

  private async refreshAccount(signal?: AbortSignal): Promise<void> {
    if (!this.isAvailable()) {
      return
    }
    try {
      const status = await this.api.getAccountStatus(signal)
      this.syncMeta = {
        ...this.syncMeta,
        uid: status.account?.uid ?? null,
        displayName:
          status.account?.displayName ??
          status.account?.login ??
          this.syncMeta.displayName,
        hasPlus: Boolean(status.plus?.hasPlus),
      }
      await this.storage.setJson(SYNC_KEY, this.syncMeta)
    } catch (error) {
      if (error instanceof YandexApiError && error.status === 401) {
        await this.logout()
      }
      throw error
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const session =
        (await this.storage.getJson<YandexAuthSession>(SESSION_KEY)) ?? null
      this.session = session
      const sync =
        (await this.storage.getJson<YandexSyncMeta>(SYNC_KEY)) ?? null
      if (sync) {
        this.syncMeta = sync
      }
      this.tracks =
        (await this.storage.getJson<Track[]>(TRACKS_KEY)) ?? []
      this.playlists =
        (await this.storage.getJson<PlaylistCache>(PLAYLISTS_KEY)) ?? []
    } catch {
      this.session = null
    }
  }

  private async getValidAccessToken(): Promise<string> {
    await this.ready
    if (!this.session?.accessToken) {
      throw new Error('Yandex Music: нет сессии')
    }
    return this.session.accessToken
  }
}

let singleton: YandexMusicAdapter | null = null

export function createYandexMusicAdapter(): YandexMusicAdapter {
  return getYandexMusicAdapter()
}

export function getYandexMusicAdapter(): YandexMusicAdapter {
  if (!singleton) {
    singleton = new YandexMusicAdapter()
  }
  return singleton
}
