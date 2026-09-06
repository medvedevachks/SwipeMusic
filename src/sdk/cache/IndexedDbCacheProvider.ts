import type {
  CacheGetOptions,
  CacheProvider,
  CacheSetOptions,
} from './CacheProvider'

const DB_NAME = 'swipe-music-provider-cache'
const STORE_NAME = 'entries'
const DB_VERSION = 1

type StoredEntry = {
  key: string
  value: unknown
  createdAt: number
  expiresAt: number | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('IDB open failed'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })
}

/**
 * IndexedDB-кэш для плагинов (offline-friendly).
 * При недоступности IDB silently miss / no-op write.
 */
export class IndexedDbCacheProvider implements CacheProvider {
  private dbPromise: Promise<IDBDatabase> | null = null

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb().catch((error) => {
        this.dbPromise = null
        throw error
      })
    }
    return this.dbPromise
  }

  async get<T>(key: string, options?: CacheGetOptions): Promise<T | null> {
    try {
      const db = await this.getDb()
      const entry = await new Promise<StoredEntry | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(key)
        req.onsuccess = () => resolve(req.result as StoredEntry | undefined)
        req.onerror = () => reject(req.error)
      })

      if (!entry) {
        return null
      }

      const now = Date.now()
      if (entry.expiresAt != null && entry.expiresAt <= now) {
        await this.delete(key)
        return null
      }

      if (
        options?.maxAgeMs != null &&
        now - entry.createdAt > options.maxAgeMs
      ) {
        return null
      }

      return entry.value as T
    } catch {
      return null
    }
  }

  async set(
    key: string,
    value: unknown,
    options?: CacheSetOptions,
  ): Promise<void> {
    try {
      const db = await this.getDb()
      const now = Date.now()
      const entry: StoredEntry = {
        key,
        value,
        createdAt: now,
        expiresAt: options?.ttlMs != null ? now + options.ttlMs : null,
      }

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(entry)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // no-op
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.getDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // no-op
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.getDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // no-op
    }
  }
}
