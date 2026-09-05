import { createLocalFolderAdapterStub } from './adapters/local-folder'
import { createMockMusicSourceAdapter } from './adapters/mock'
import { createOfficialApiAdapterStub } from './adapters/official-api'
import { createWebSourceAdapterStub } from './adapters/web'
import type { MusicSourceAdapter } from './MusicSourceAdapter'
import {
  MusicSourceNotActiveError,
  musicSourceRegistry,
} from './registry'
import type { FetchTracksParams, FetchTracksResult } from './types'
import type { Track } from '../types/track'

let bootstrapped = false

/** Регистрирует встроенные адаптеры. Вызывать один раз при старте. */
export function bootstrapMusicSources(): void {
  if (bootstrapped) {
    return
  }

  musicSourceRegistry.register(createMockMusicSourceAdapter())
  // Заглушки зарегистрированы, но не активны — архитектура multi-source готова.
  musicSourceRegistry.register(
    createOfficialApiAdapterStub({ id: 'spotify', label: 'Spotify' }),
  )
  musicSourceRegistry.register(
    createOfficialApiAdapterStub({ id: 'yandex-music', label: 'Яндекс Музыка' }),
  )
  musicSourceRegistry.register(createLocalFolderAdapterStub())
  musicSourceRegistry.register(createWebSourceAdapterStub())

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

export function activateMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  musicSourceRegistry.activate(sourceId)
}

export function deactivateMusicSource(sourceId: string): void {
  bootstrapMusicSources()
  musicSourceRegistry.deactivate(sourceId)
}

export function getActiveMusicSource(): MusicSourceAdapter {
  bootstrapMusicSources()
  return musicSourceRegistry.getActive()
}

export function listMusicSources(): MusicSourceAdapter[] {
  bootstrapMusicSources()
  return musicSourceRegistry.list()
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
 * Треки со всех одновременно активных источников.
 * Дубликаты по Track.id отбрасываются.
 */
export async function fetchTracksFromActiveSources(
  params?: FetchTracksParams,
): Promise<FetchTracksResult> {
  bootstrapMusicSources()
  const sources = musicSourceRegistry.listActive()

  if (sources.length === 0) {
    throw new MusicSourceNotActiveError()
  }

  const results = await Promise.all(
    sources.map(async (source) => {
      const available = await source.isAvailable()
      if (!available) {
        return { tracks: [] as Track[], nextCursor: null }
      }
      return source.fetchTracks(params)
    }),
  )

  const seen = new Set<string>()
  const tracks: Track[] = []

  for (const result of results) {
    for (const track of result.tracks) {
      if (seen.has(track.id)) {
        continue
      }
      seen.add(track.id)
      tracks.push(track)
    }
  }

  return { tracks, nextCursor: null }
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
