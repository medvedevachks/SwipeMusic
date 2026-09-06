import type { MusicSourceAdapter, MusicSourceAdapterFactory } from './MusicSourceAdapter'
import { createCustomWebsiteAdapter } from './adapters/web'
import { createLocalFolderAdapter } from './adapters/local-folder'
import { createMockMusicSourceAdapter } from './adapters/mock'
import { createSpotifyAdapter } from './adapters/spotify'
import { createVKMusicAdapter } from './adapters/vk-music'
import { createYandexMusicAdapter } from './adapters/yandex-music'
import { createZaycevAdapter } from './adapters/zaycev'

export class MusicSourceNotFoundError extends Error {
  constructor(sourceId: string) {
    super(`Music source "${sourceId}" is not registered`)
    this.name = 'MusicSourceNotFoundError'
  }
}

export class MusicSourceNotActiveError extends Error {
  constructor() {
    super('No active music source is selected')
    this.name = 'MusicSourceNotActiveError'
  }
}

type BuiltInEntry = {
  id: string
  factory: MusicSourceAdapterFactory
}

/** Встроенные адаптеры — auto-register без правок UI. */
const BUILT_IN_ADAPTERS: BuiltInEntry[] = [
  { id: 'mock', factory: createMockMusicSourceAdapter },
  { id: 'spotify', factory: createSpotifyAdapter },
  { id: 'yandex-music', factory: createYandexMusicAdapter },
  { id: 'vk-music', factory: createVKMusicAdapter },
  { id: 'zaycev', factory: createZaycevAdapter },
  { id: 'local-folder', factory: createLocalFolderAdapter },
  { id: 'custom-website', factory: () => createCustomWebsiteAdapter() },
]

/**
 * Реестр адаптеров. Автоматически регистрирует встроенные фабрики.
 * SourceManager опирается на этот слой.
 */
export class SourceRegistry {
  private readonly adapters = new Map<string, MusicSourceAdapter>()
  private readonly factories = new Map<string, MusicSourceAdapterFactory>()
  private autoRegistered = false

  /** Регистрация фабрики для ленивого создания / пересоздания. */
  registerFactory(id: string, factory: MusicSourceAdapterFactory): void {
    this.factories.set(id, factory)
  }

  register(adapter: MusicSourceAdapter): void {
    this.adapters.set(adapter.id, adapter)
    if (!this.factories.has(adapter.id)) {
      this.factories.set(adapter.id, () => adapter)
    }
  }

  /** Регистрирует все встроенные адаптеры один раз. */
  autoRegister(): void {
    if (this.autoRegistered) {
      return
    }

    for (const entry of BUILT_IN_ADAPTERS) {
      this.registerFactory(entry.id, entry.factory)
      if (!this.adapters.has(entry.id)) {
        this.register(entry.factory())
      }
    }

    this.autoRegistered = true
  }

  unregister(id: string): void {
    const adapter = this.adapters.get(id)
    void adapter?.dispose()
    this.adapters.delete(id)
    this.factories.delete(id)
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  get(id: string): MusicSourceAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new MusicSourceNotFoundError(id)
    }
    return adapter
  }

  list(): MusicSourceAdapter[] {
    return [...this.adapters.values()]
  }

  listFactoryIds(): string[] {
    return [...this.factories.keys()]
  }
}

/**
 * @deprecated Совместимость: multi-active API теперь в SourceManager.
 * Обёртка над SourceRegistry + делегирование enable через callbacks.
 */
export class MusicSourceRegistry {
  private readonly registry: SourceRegistry
  private readonly activeIds = new Set<string>()
  private primaryId: string | null = null

  constructor(registry: SourceRegistry = sourceRegistry) {
    this.registry = registry
  }

  register(adapter: MusicSourceAdapter): void {
    this.registry.register(adapter)
    if (!this.primaryId) {
      this.primaryId = adapter.id
      this.activeIds.add(adapter.id)
    }
  }

  unregister(id: string): void {
    this.registry.unregister(id)
    this.activeIds.delete(id)
    if (this.primaryId === id) {
      this.primaryId =
        this.activeIds.values().next().value ??
        this.registry.list()[0]?.id ??
        null
      if (this.primaryId) {
        this.activeIds.add(this.primaryId)
      }
    }
  }

  has(id: string): boolean {
    return this.registry.has(id)
  }

  get(id: string): MusicSourceAdapter {
    return this.registry.get(id)
  }

  list(): MusicSourceAdapter[] {
    return this.registry.list()
  }

  activate(id: string): void {
    if (!this.registry.has(id)) {
      throw new MusicSourceNotFoundError(id)
    }
    this.activeIds.add(id)
    if (!this.primaryId) {
      this.primaryId = id
    }
  }

  deactivate(id: string): void {
    this.activeIds.delete(id)
    if (this.primaryId === id) {
      this.primaryId = this.activeIds.values().next().value ?? null
    }
  }

  isActive(id: string): boolean {
    return this.activeIds.has(id)
  }

  getActiveIds(): string[] {
    return [...this.activeIds]
  }

  listActive(): MusicSourceAdapter[] {
    return this.getActiveIds().map((id) => this.get(id))
  }

  setActive(id: string): void {
    this.activate(id)
    this.primaryId = id
  }

  getActiveId(): string | null {
    return this.primaryId
  }

  getActive(): MusicSourceAdapter {
    if (!this.primaryId) {
      throw new MusicSourceNotActiveError()
    }
    return this.get(this.primaryId)
  }

  /** Синхронизация active-набора из SourceManager.enabled. */
  syncActiveFromEnabled(enabledIds: string[], primaryId?: string | null): void {
    this.activeIds.clear()
    for (const id of enabledIds) {
      if (this.registry.has(id)) {
        this.activeIds.add(id)
      }
    }
    this.primaryId =
      primaryId && this.activeIds.has(primaryId)
        ? primaryId
        : (this.activeIds.values().next().value ?? null)
  }
}

export const sourceRegistry = new SourceRegistry()
/** Единый экземпляр реестра на приложение (обратная совместимость). */
export const musicSourceRegistry = new MusicSourceRegistry(sourceRegistry)
