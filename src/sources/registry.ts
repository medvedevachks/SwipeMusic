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
 * Реестр адаптеров. Приложение работает только через него,
 * а не через конкретные Spotify/Yandex/Local реализации.
 */
export class MusicSourceRegistry {
  private readonly adapters = new Map<string, MusicSourceAdapter>()
  private activeId: string | null = null

  register(adapter: MusicSourceAdapter): void {
    this.adapters.set(adapter.id, adapter)

    if (!this.activeId) {
      this.activeId = adapter.id
    }
  }

  unregister(id: string): void {
    const adapter = this.adapters.get(id)
    void adapter?.dispose?.()
    this.adapters.delete(id)

    if (this.activeId === id) {
      this.activeId = this.adapters.keys().next().value ?? null
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

  setActive(id: string): void {
    if (!this.adapters.has(id)) {
      throw new MusicSourceNotFoundError(id)
    }
    this.activeId = id
  }

  getActiveId(): string | null {
    return this.activeId
  }

  getActive(): MusicSourceAdapter {
    if (!this.activeId) {
      throw new MusicSourceNotActiveError()
    }
    return this.get(this.activeId)
  }
}

/** Единый экземпляр реестра на приложение. */
export const musicSourceRegistry = new MusicSourceRegistry()
