import { createProviderStorage } from '../../../sdk/storage'
import type {
  AuthenticationProvider,
  ProviderStatusDescriptor,
} from '../../../sdk/types'
import { getMediaIndex, indexTracksForSource } from '../../../services/mediaIndex'
import { useAuthStore } from '../../../store/authStore'
import {
  disconnectYandexAccount,
  persistNewYandexSession,
  reconcileYandexConnection,
} from './reconcileSession'
import {
  deleteYandexConnection,
  readYandexConnection,
  saveYandexConnection,
} from './sessionClient'
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
const OWNER_KEY = 'cacheOwnerUserId'
const SYNC_KEY = 'syncMeta'
const PLAYLISTS_KEY = 'playlists'
const TRACKS_KEY = 'libraryTracks'

type PlaylistCache = Array<{ id: string; name: string; trackIds: string[] }>

const EMPTY_SYNC: YandexSyncMeta = {
  lastSyncedAt: null,
  trackCount: 0,
  playlistCount: 0,
  displayName: null,
  uid: null,
  hasPlus: false,
}

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
  private tracks: Track[] = []
  private playlists: PlaylistCache = []
  private syncMeta: YandexSyncMeta = { ...EMPTY_SYNC }
  private ready: Promise<void>
  private api: YandexMusicApiClient
  private syncing = false
  private connected = false
  private pendingDevice: YandexDeviceCode | null = null
  private authAbort: AbortController | null = null
  private bindGeneration = 0
  private unsubscribeAuth: (() => void) | null = null

  constructor() {
    this.api = new YandexMusicApiClient()
    this.ready = this.bindAccount()
    this.unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      const nextId = state.user?.id ?? null
      const prevId = previous.user?.id ?? null
      if (nextId === prevId) {
        return
      }
      this.connected = false
      this.clearMemory()
      void this.bindAccount()
    })
  }

  async initialize(): Promise<void> {
    await this.ready
    await this.bindAccount()
    pushYandexDevLog({
      stage: 'register',
      message: 'YandexMusicAdapter initialized',
      detail: 'experimental internal API',
    })
  }

  isAvailable(): boolean {
    return this.connected
  }

  async dispose(): Promise<void> {
    this.authAbort?.abort()
    this.unsubscribeAuth?.()
    this.unsubscribeAuth = null
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

      const profile = await persistNewYandexSession(session, (value) =>
        saveYandexConnection(value),
      )
      this.pendingDevice = null
      this.connected = true
      const userId = useAuthStore.getState().user?.id ?? null
      if (userId) {
        await this.storage.setJson(OWNER_KEY, userId)
      }
      this.applyProfile(profile)
      try {
        await this.refreshAccount()
      } catch (error) {
        if (error instanceof YandexApiError && error.status === 401) {
          throw error
        }
        pushYandexDevLog({
          stage: 'error',
          message: 'account refresh failed',
        })
      }
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
    this.pendingDevice = null
    this.connected = false
    await disconnectYandexAccount({
      deleteRemote: () => deleteYandexConnection(),
      removeLegacy: () => this.storage.remove(SESSION_KEY),
      clearLibrary: () => this.clearStoredLibrary(),
    })
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

    await this.bindAccount()

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
        this.connected = false
        if (error.code === 'UNAUTHENTICATED') {
          this.clearMemory()
        } else {
          await this.storage.remove(SESSION_KEY)
          await this.clearStoredLibrary()
          await deleteYandexConnection()
        }
      }
      throw error
    }
  }

  private async bindAccount(): Promise<void> {
    const generation = ++this.bindGeneration
    const userId = useAuthStore.getState().user?.id ?? null
    if (!userId) {
      this.connected = false
      this.clearMemory()
      return
    }

    const outcome = await reconcileYandexConnection({
      userId,
      readStatus: () => readYandexConnection(),
      saveLegacy: (legacy) => saveYandexConnection(legacy),
      storage: {
        readLegacy: () => this.storage.getJson<YandexAuthSession>(SESSION_KEY),
        removeLegacy: () => this.storage.remove(SESSION_KEY),
        readOwner: async () => {
          const owner = await this.storage.getJson<string>(OWNER_KEY)
          return typeof owner === 'string' ? owner : null
        },
        writeOwner: (ownerId) => this.storage.setJson(OWNER_KEY, ownerId),
        clearLibrary: () => this.clearStoredLibrary(),
      },
    })
    if (generation !== this.bindGeneration) {
      return
    }
    this.connected = outcome.connected
    if (!outcome.connected) {
      this.clearMemory()
      return
    }
    await this.loadLibraryCache()
    this.applyProfile(outcome.profile)
  }

  private applyProfile(
    profile: { displayName: string | null; hasPlus: boolean; uid: number | null } | null,
  ): void {
    if (!profile) {
      return
    }
    this.syncMeta = {
      ...this.syncMeta,
      displayName: profile.displayName ?? this.syncMeta.displayName,
      hasPlus: profile.hasPlus,
      uid: profile.uid ?? this.syncMeta.uid,
    }
  }

  private clearMemory(): void {
    this.tracks = []
    this.playlists = []
    this.syncMeta = { ...EMPTY_SYNC }
  }

  private async clearStoredLibrary(): Promise<void> {
    this.clearMemory()
    await this.storage.remove(TRACKS_KEY)
    await this.storage.remove(PLAYLISTS_KEY)
    await this.storage.remove(SYNC_KEY)
    const index = getMediaIndex()
    await index.whenReady()
    index.replaceSource(SOURCE_ID, [])
  }

  private async loadLibraryCache(): Promise<void> {
    const sync = await this.storage.getJson<YandexSyncMeta>(SYNC_KEY)
    if (sync) {
      this.syncMeta = { ...EMPTY_SYNC, ...sync }
    }
    this.tracks = (await this.storage.getJson<Track[]>(TRACKS_KEY)) ?? []
    this.playlists = (await this.storage.getJson<PlaylistCache>(PLAYLISTS_KEY)) ?? []
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
