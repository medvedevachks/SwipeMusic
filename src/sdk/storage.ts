import type { ProviderStorage } from './types'

const PREFIX = 'sm-provider:'

/**
 * Простое key-value хранилище настроек плагина на localStorage.
 * Тяжёлые данные — через CacheProvider (IndexedDB).
 */
export function createProviderStorage(pluginId: string): ProviderStorage {
  const ns = `${PREFIX}${pluginId}:`

  return {
    async getJson<T>(key: string): Promise<T | null> {
      try {
        const raw = localStorage.getItem(ns + key)
        if (raw == null) {
          return null
        }
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    async setJson(key: string, value: unknown): Promise<void> {
      localStorage.setItem(ns + key, JSON.stringify(value))
    },

    async remove(key: string): Promise<void> {
      localStorage.removeItem(ns + key)
    },
  }
}
