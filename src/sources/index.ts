import { createMockMusicSourceAdapter } from './adapters/mock'
import { createYandexMusicSourceAdapter } from './adapters/yandex-music'
import { createZaycevMusicSourceAdapter } from './adapters/zaycev'
import type { MusicSourceAdapter } from './MusicSourceAdapter'
import { musicSourceRegistry } from './registry'
import type { FetchTracksParams, FetchTracksResult } from './types'

let bootstrapped = false

/** Регистрирует встроенные адаптеры. Вызывать один раз при старте. */
export function bootstrapMusicSources(): void {
  if (bootstrapped) {
    return
  }

  musicSourceRegistry.register(createMockMusicSourceAdapter())
  musicSourceRegistry.register(createZaycevMusicSourceAdapter())
  musicSourceRegistry.register(createYandexMusicSourceAdapter())

  musicSourceRegistry.setActive('mock')
  bootstrapped = true
}

export function registerMusicSource(adapter: MusicSourceAdapter): void {
  bootstrapMusicSources()
  musicSourceRegistry.register(adapter)
}

export function setActiveMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  musicSourceRegistry.setActive(sourceId)
}

export function getActiveMusicSource(): MusicSourceAdapter {
  bootstrapMusicSources()
  return musicSourceRegistry.getActive()
}

export function listMusicSources(): MusicSourceAdapter[] {
  bootstrapMusicSources()
  return musicSourceRegistry.list()
}

/** Единая точка получения треков для UI / store — без знания поставщика. */
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

export type { MusicSourceAdapter } from './MusicSourceAdapter'
export type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceDescriptor,
  MusicSourceKind,
} from './types'
export { createTrack, createTrackId } from './normalizeTrack'
export { musicSourceRegistry } from './registry'
export { createMockMusicSourceAdapter } from './adapters/mock'
export { createOfficialApiAdapterStub } from './adapters/official-api'
export { createLocalFolderAdapterStub } from './adapters/local-folder'
export { createWebSourceAdapterStub } from './adapters/web'
export { createZaycevMusicSourceAdapter } from './adapters/zaycev'
export { createYandexMusicSourceAdapter } from './adapters/yandex-music'
export { CAPABILITY_LABELS, hasCapability } from './types'
