import type {
  CacheGetOptions,
  CacheProvider,
  CacheSetOptions,
} from './CacheProvider'

type MemoryEntry = {
  value: unknown
  expiresAt: number | null
  createdAt: number
}

export class MemoryCacheProvider implements CacheProvider {
  private readonly store = new Map<string, MemoryEntry>()

  async get<T>(key: string, options?: CacheGetOptions): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) {
      return null
    }

    const now = Date.now()
    if (entry.expiresAt != null && entry.expiresAt <= now) {
      this.store.delete(key)
      return null
    }

    if (
      options?.maxAgeMs != null &&
      now - entry.createdAt > options.maxAgeMs
    ) {
      return null
    }

    return entry.value as T
  }

  async set(
    key: string,
    value: unknown,
    options?: CacheSetOptions,
  ): Promise<void> {
    const now = Date.now()
    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt:
        options?.ttlMs != null ? now + options.ttlMs : null,
    })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }
}
