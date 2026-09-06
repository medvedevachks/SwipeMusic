import type { LibraryProvider } from '../types/libraryProvider'
import type { Track } from '../types/track'
import type { MusicSourceAdapter } from '../sources/MusicSourceAdapter'
import type { CacheProvider } from './cache/CacheProvider'
import type { EventBus } from './EventBus'
import type { HttpClient } from './http/HttpClient'
import type { ProviderLogger } from './logger'

/** Возможности источника — UI смотрит только на них, без if (spotify). */
export type ProviderCapabilities = {
  search: boolean
  library: boolean
  streaming: boolean
  download: boolean
  artwork: boolean
  authentication: boolean
  lyrics: boolean
}

export type ProviderManifest = {
  id: string
  name: string
  version: string
  author?: string
  icon?: string
  description?: string
  /** Приоритет в SourceManager (меньше — выше). */
  defaultPriority?: number
  /** Включать ли при первой регистрации. */
  defaultEnabled?: boolean
  capabilities: ProviderCapabilities
}

export type ProviderSettings = Record<string, string | number | boolean | null>

export type ProviderStorage = {
  getJson<T>(key: string): Promise<T | null>
  setJson(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/**
 * Контекст, который получает каждый плагин.
 * Плагин не создаёт http/cache/logger самостоятельно.
 */
export type ProviderContext = {
  pluginId: string
  logger: ProviderLogger
  cache: CacheProvider
  settings: ProviderSettings
  http: HttpClient
  signal: AbortSignal
  storage: ProviderStorage
  eventBus: EventBus
}

/** Опциональные контракты — плагин реализует только нужные. */
export type SearchProvider = {
  search(query: string, signal?: AbortSignal): Promise<Track[]>
}

export type MetadataProvider = {
  getMetadata(trackId: string, signal?: AbortSignal): Promise<Partial<Track> | null>
}

export type ArtworkProvider = {
  getArtwork(track: Track, signal?: AbortSignal): Promise<string | undefined>
}

export type AuthenticationProvider = {
  isAuthenticated(): Promise<boolean>
  login(): Promise<void>
  logout(): Promise<void>
}

export type Downloader = {
  download(track: Track, signal?: AbortSignal): Promise<Blob>
}

/**
 * Единица расширения платформы.
 * Обязателен только manifest + createMusicSourceAdapter.
 */
export type ProviderPlugin = {
  manifest: ProviderManifest
  createMusicSourceAdapter: (ctx: ProviderContext) => MusicSourceAdapter
  createLibraryProvider?: (ctx: ProviderContext) => LibraryProvider | null
  createSearchProvider?: (ctx: ProviderContext) => SearchProvider | null
  createMetadataProvider?: (ctx: ProviderContext) => MetadataProvider | null
  createArtworkProvider?: (ctx: ProviderContext) => ArtworkProvider | null
  createAuthenticationProvider?: (
    ctx: ProviderContext,
  ) => AuthenticationProvider | null
  createDownloader?: (ctx: ProviderContext) => Downloader | null
}

export const EMPTY_CAPABILITIES: ProviderCapabilities = {
  search: false,
  library: false,
  streaming: false,
  download: false,
  artwork: false,
  authentication: false,
  lyrics: false,
}
