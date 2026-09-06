import { sourceManager } from './SourceManager'
import type { MusicSourceAdapter } from './MusicSourceAdapter'
import {
  musicSourceRegistry,
  sourceRegistry,
} from './registry'
import type { FetchTracksParams, FetchTracksResult } from './types'
import type { Track } from '../types/track'
import {
  bootstrapProviderPlugins,
  pluginFromAdapter,
  registerPlugin,
} from '../sdk'

let bootstrapped = false

/**
 * Регистрирует встроенные адаптеры через SourceManager + Provider Plugin SDK.
 */
export function bootstrapMusicSources(): void {
  if (bootstrapped) {
    return
  }

  sourceManager.bootstrap()
  bootstrapProviderPlugins()
  bootstrapped = true
}

/**
 * Подключение источника одной строкой:
 * registerMusicSource(new ZaycevAdapter())
 * Работает через PluginRegistry (plugin-first).
 */
export function registerMusicSource(adapter: MusicSourceAdapter): void {
  bootstrapMusicSources()
  registerPlugin(pluginFromAdapter(adapter))
}

export function setActiveMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  sourceManager.enableSource(sourceId)
  musicSourceRegistry.setActive(sourceId)
}

export function activateMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  sourceManager.enableSource(sourceId)
}

export function deactivateMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  sourceManager.disableSource(sourceId)
}

export function getActiveMusicSource(): MusicSourceAdapter {
  bootstrapMusicSources()
  return musicSourceRegistry.getActive()
}

export function listMusicSources(): MusicSourceAdapter[] {
  bootstrapMusicSources()
  return sourceRegistry.list()
}

export function listActiveMusicSources(): MusicSourceAdapter[] {
  bootstrapMusicSources()
  return musicSourceRegistry.listActive()
}

/** Треки только от primary-источника (обратная совместимость). */
export async function fetchTracksFromActiveSource(
  params?: FetchTracksParams,
): Promise<FetchTracksResult> {
  bootstrapMusicSources()
  const source = musicSourceRegistry.getActive()
  const available = await source.isAvailable()

  if (!available) {
    throw new Error(`Music source "${source.id}" is not available`)
  }

  return source.fetchTracks(params)
}

/**
 * Треки со всех включённых источников (SourceManager).
 * Дубликаты по Track.id отбрасываются.
 */
export async function fetchTracksFromActiveSources(
  params?: FetchTracksParams,
): Promise<FetchTracksResult> {
  bootstrapMusicSources()
  return sourceManager.fetchMergedTracks(params)
}

export type { MusicSourceAdapter, SearchResult } from './MusicSourceAdapter'
export type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceDescriptor,
  MusicSourceKind,
} from './types'
export { createTrack, createTrackId } from './normalizeTrack'
export {
  musicSourceRegistry,
  sourceRegistry,
  MusicSourceNotActiveError,
  MusicSourceNotFoundError,
} from './registry'
export {
  sourceManager,
  sourceTypeLabel,
  normalizeSourceType,
} from './SourceManager'
export type {
  SourceConfig,
  SourceType,
  SourceTypeInput,
  CreateSourceInput,
} from '../types/source'

export { createMockMusicSourceAdapter } from './adapters/mock'
export { SpotifyAdapter, createSpotifyAdapter } from './adapters/spotify'
export {
  YandexMusicAdapter,
  createYandexMusicAdapter,
} from './adapters/yandex-music'
export { VKMusicAdapter, createVKMusicAdapter } from './adapters/vk-music'
export { ZaycevAdapter, createZaycevAdapter } from './adapters/zaycev'
export { ExampleAdapter, createExampleAdapter } from './adapters/example'
export {
  FileSystemMusicAdapter,
  createLocalFolderAdapter,
  createLocalFolderAdapterStub,
  getFileSystemMusicAdapter,
  LOCAL_AUDIO_EXTENSIONS,
} from './adapters/local-folder'
export type {
  LocalAccessState,
  LocalLibraryStats,
  LocalScanProgress,
} from './adapters/local-folder'
export {
  MyMusicSiteAdapter,
  createMyMusicSiteAdapter,
  createCustomWebsiteAdapter,
  createWebSourceAdapterStub,
} from './adapters/web'
export { createOfficialApiAdapterStub } from './adapters/official-api'
export { ApiMusicAdapter } from './adapters/ApiMusicAdapter'
export { ScraperMusicAdapter } from './adapters/ScraperMusicAdapter'
export {
  BrowserHtmlFetcher,
  BackendProxyHtmlFetcher,
  BackendHtmlFetcher,
  type HtmlFetcher,
} from './scraping'

export type { Track }

export { resolvePlaybackUrl } from './resolvePlaybackUrl'
