import { sourceManager } from './SourceManager'
import type { MusicSourceAdapter } from './MusicSourceAdapter'
import {
  musicSourceRegistry,
  sourceRegistry,
} from './registry'
import type { FetchTracksParams, FetchTracksResult } from './types'
import type { Track } from '../types/track'

let bootstrapped = false

/** Регистрирует встроенные адаптеры через SourceManager / SourceRegistry. */
export function bootstrapMusicSources(): void {
  if (bootstrapped) {
    return
  }

  sourceManager.bootstrap()
  bootstrapped = true
}

export function registerMusicSource(adapter: MusicSourceAdapter): void {
  bootstrapMusicSources()
  sourceRegistry.register(adapter)
  musicSourceRegistry.register(adapter)
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

export type { MusicSourceAdapter } from './MusicSourceAdapter'
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
export { sourceManager, sourceTypeLabel } from './SourceManager'
export type { SourceConfig, SourceType, CreateSourceInput } from '../types/source'

export { createMockMusicSourceAdapter } from './adapters/mock'
export { createSpotifyAdapter } from './adapters/spotify'
export { createYandexMusicAdapter } from './adapters/yandex-music'
export { createVKMusicAdapter } from './adapters/vk-music'
export { createZaycevAdapter } from './adapters/zaycev'
export { createLocalFolderAdapter, createLocalFolderAdapterStub } from './adapters/local-folder'
export {
  createCustomWebsiteAdapter,
  createWebSourceAdapterStub,
} from './adapters/web'
export { createOfficialApiAdapterStub } from './adapters/official-api'

export type { Track }
