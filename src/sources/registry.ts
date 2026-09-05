import type { MusicSourceAdapter } from './MusicSourceAdapter'

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

/**
 * Реестр адаптеров с поддержкой нескольких одновременно активных источников.
 * Приложение работает только через него, а не через конкретные реализации.
 */
export class MusicSourceRegistry {
  private readonly adapters = new Map<string, MusicSourceAdapter>()
  private readonly activeIds = new Set<string>()
  /** Primary — для обратной совместимости getActive() / setActive(). */
  private primaryId: string | null = null

  register(adapter: MusicSourceAdapter): void {
    this.adapters.set(adapter.id, adapter)

    if (!this.primaryId) {
      this.primaryId = adapter.id
      this.activeIds.add(adapter.id)
    }
  }

  unregister(id: string): void {
    const adapter = this.adapters.get(id)
    void adapter?.dispose?.()
    this.adapters.delete(id)
    this.activeIds.delete(id)

    if (this.primaryId === id) {
      this.primaryId = this.activeIds.values().next().value
        ?? this.adapters.keys().next().value
        ?? null

      if (this.primaryId) {
        this.activeIds.add(this.primaryId)
      }
    }
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

  /** Включить источник в multi-active ленту. */
  activate(id: string): void {
    if (!this.adapters.has(id)) {
      throw new MusicSourceNotFoundError(id)
    }
    this.activeIds.add(id)
    if (!this.primaryId) {
      this.primaryId = id
    }
  }

  /** Исключить источник из multi-active ленты. */
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

  /**
   * Активирует источник и делает его primary.
   * Сохраняет обратную совместимость с single-active API.
   */
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
}

/** Единый экземпляр реестра на приложение. */
export const musicSourceRegistry = new MusicSourceRegistry()
