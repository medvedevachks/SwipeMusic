import type { CreateSourceInput, SourceConfig, SourceType } from '../types/source'
import type { Track } from '../types/track'
import { createId } from '../utils/id'
import { createCustomWebsiteAdapter } from './adapters/web'
import type { MusicSourceAdapter } from './MusicSourceAdapter'
import {
  MusicSourceNotActiveError,
  MusicSourceNotFoundError,
  musicSourceRegistry,
  sourceRegistry,
} from './registry'
import type { FetchTracksParams, FetchTracksResult } from './types'

type SourceManagerListener = (sources: SourceConfig[]) => void

const DEFAULT_CONFIGS: SourceConfig[] = [
  {
    id: 'mock',
    name: 'Demo library',
    type: 'custom',
    enabled: true,
    priority: 0,
    settings: { demo: true },
  },
  {
    id: 'spotify',
    name: 'Spotify',
    type: 'api',
    enabled: false,
    priority: 10,
    settings: {},
  },
  {
    id: 'yandex-music',
    name: 'Яндекс Музыка',
    type: 'api',
    enabled: false,
    priority: 20,
    settings: {},
  },
  {
    id: 'vk-music',
    name: 'VK Музыка',
    type: 'api',
    enabled: false,
    priority: 30,
    settings: {},
  },
  {
    id: 'zaycev',
    name: 'Zaycev.net',
    type: 'html-parser',
    enabled: false,
    priority: 40,
    settings: {},
  },
  {
    id: 'local-folder',
    name: 'Локальная папка',
    type: 'local-folder',
    enabled: false,
    priority: 50,
    settings: {},
  },
  {
    id: 'custom-website',
    name: 'Custom website',
    type: 'custom',
    enabled: false,
    priority: 60,
    settings: {},
  },
]

/**
 * Оркестратор источников: configs + adapters + объединённая лента Track[].
 * UI и Swipe Engine работают только с результатом fetchMergedTracks().
 */
export class SourceManager {
  private readonly configs = new Map<string, SourceConfig>()
  private readonly listeners = new Set<SourceManagerListener>()
  private bootstrapped = false

  bootstrap(): void {
    if (this.bootstrapped) {
      return
    }

    sourceRegistry.autoRegister()

    for (const config of DEFAULT_CONFIGS) {
      this.configs.set(config.id, { ...config, settings: { ...config.settings } })
    }

    this.bootstrapped = true
    this.syncLegacyRegistry()
    this.emit()
  }

  listSources(): SourceConfig[] {
    this.ensureBootstrapped()
    return [...this.configs.values()].sort((a, b) => a.priority - b.priority)
  }

  getSource(id: string): SourceConfig {
    this.ensureBootstrapped()
    const config = this.configs.get(id)
    if (!config) {
      throw new MusicSourceNotFoundError(id)
    }
    return config
  }

  addSource(input: CreateSourceInput, adapter?: MusicSourceAdapter): SourceConfig {
    this.ensureBootstrapped()

    const id = input.id?.trim() || createId('src')
    if (this.configs.has(id)) {
      throw new Error(`Source "${id}" already exists`)
    }

    const config: SourceConfig = {
      id,
      name: input.name.trim() || 'Новый источник',
      type: input.type,
      enabled: input.enabled ?? false,
      priority: input.priority ?? this.nextPriority(),
      settings: { ...(input.settings ?? {}) },
    }

    const resolvedAdapter =
      adapter ??
      createCustomWebsiteAdapter({
        id,
        label: config.name,
      })

    sourceRegistry.register(resolvedAdapter)
    void resolvedAdapter.initialize()

    this.configs.set(id, config)
    this.syncLegacyRegistry()
    this.emit()
    return config
  }

  removeSource(id: string): void {
    this.ensureBootstrapped()
    if (!this.configs.has(id)) {
      throw new MusicSourceNotFoundError(id)
    }

    // Демо-источник нельзя удалить — иначе сломается лента.
    if (id === 'mock') {
      return
    }

    sourceRegistry.unregister(id)
    this.configs.delete(id)
    this.syncLegacyRegistry()
    this.emit()
  }

  enableSource(id: string): void {
    this.setEnabled(id, true)
  }

  disableSource(id: string): void {
    this.setEnabled(id, false)
  }

  setPriority(id: string, priority: number): void {
    this.ensureBootstrapped()
    const config = this.getSource(id)
    this.configs.set(id, { ...config, priority })
    this.emit()
  }

  updateSettings(id: string, settings: SourceConfig['settings']): void {
    this.ensureBootstrapped()
    const config = this.getSource(id)
    this.configs.set(id, {
      ...config,
      settings: { ...config.settings, ...settings },
    })
    this.emit()
  }

  /** Включённые источники, отсортированные по priority. */
  listEnabledSources(): SourceConfig[] {
    return this.listSources().filter((source) => source.enabled)
  }

  getAdapter(id: string): MusicSourceAdapter {
    this.ensureBootstrapped()
    return sourceRegistry.get(id)
  }

  /**
   * Общая лента Track[] из всех enabled-источников.
   * Дубликаты по id отбрасываются; порядок — по priority источника.
   */
  async fetchMergedTracks(
    params?: FetchTracksParams,
  ): Promise<FetchTracksResult> {
    this.ensureBootstrapped()
    const enabled = this.listEnabledSources()

    if (enabled.length === 0) {
      throw new MusicSourceNotActiveError()
    }

    const results = await Promise.all(
      enabled.map(async (config) => {
        const adapter = sourceRegistry.get(config.id)
        const available = await adapter.isAvailable()
        if (!available) {
          return { tracks: [] as Track[], nextCursor: null }
        }
        return adapter.fetchTracks(params)
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

  subscribe(listener: SourceManagerListener): () => void {
    this.listeners.add(listener)
    listener(this.listSources())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setEnabled(id: string, enabled: boolean): void {
    this.ensureBootstrapped()
    const config = this.getSource(id)

    // Нельзя выключить последний enabled-источник.
    if (!enabled && config.enabled) {
      const enabledCount = this.listEnabledSources().length
      if (enabledCount <= 1) {
        return
      }
    }

    this.configs.set(id, { ...config, enabled })
    this.syncLegacyRegistry()
    this.emit()
  }

  private nextPriority(): number {
    const values = this.listSources().map((source) => source.priority)
    return values.length === 0 ? 0 : Math.max(...values) + 10
  }

  private syncLegacyRegistry(): void {
    const enabledIds = this.listEnabledSources().map((source) => source.id)
    const primaryId = enabledIds[0] ?? null
    musicSourceRegistry.syncActiveFromEnabled(enabledIds, primaryId)
  }

  private ensureBootstrapped(): void {
    if (!this.bootstrapped) {
      this.bootstrap()
    }
  }

  private emit(): void {
    const snapshot = this.listSources()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

export const sourceManager = new SourceManager()

export function sourceTypeLabel(type: SourceType): string {
  switch (type) {
    case 'api':
      return 'API'
    case 'html-parser':
      return 'HTML parser'
    case 'rss':
      return 'RSS'
    case 'local-folder':
      return 'Local folder'
    case 'custom':
      return 'Custom'
  }
}
