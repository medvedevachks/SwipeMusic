import { MemoryCacheProvider } from './cache/MemoryCacheProvider'
import { IndexedDbCacheProvider } from './cache/IndexedDbCacheProvider'
import { platformEventBus } from './EventBus'
import { HttpClient } from './http/HttpClient'
import { createProviderLogger } from './logger'
import { createProviderStorage } from './storage'
import type { ProviderContext, ProviderSettings } from './types'

const memoryCache = new MemoryCacheProvider()
const idbCache = new IndexedDbCacheProvider()

export type CreateProviderContextOptions = {
  settings?: ProviderSettings
  signal?: AbortSignal
  /** 'memory' | 'indexeddb' — default memory with IDB fallback for get/set via namespaced keys. */
  cacheMode?: 'memory' | 'indexeddb'
}

/**
 * Фабрика ProviderContext для плагина.
 */
export function createProviderContext(
  pluginId: string,
  options: CreateProviderContextOptions = {},
): ProviderContext {
  const cache =
    options.cacheMode === 'indexeddb' ? idbCache : memoryCache

  const http = new HttpClient({
    timeoutMs: 15_000,
    retries: 1,
    cache: {
      get: (key) => cache.get(key),
      set: (key, value, ttlMs) => cache.set(key, value, { ttlMs }),
    },
  })

  const controller = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort()
    } else {
      options.signal.addEventListener(
        'abort',
        () => controller.abort(),
        { once: true },
      )
    }
  }

  return {
    pluginId,
    logger: createProviderLogger(pluginId),
    cache,
    settings: { ...options.settings },
    http,
    signal: controller.signal,
    storage: createProviderStorage(pluginId),
    eventBus: platformEventBus,
  }
}
