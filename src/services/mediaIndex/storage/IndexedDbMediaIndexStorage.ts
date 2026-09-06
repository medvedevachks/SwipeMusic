import type { TrackRecord } from '../types'
import type { MediaIndexStorage } from './MediaIndexStorage'

const DB_NAME = 'swipe-music-media-index'
const DB_VERSION = 1
const STORE = 'tracks'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open media index DB'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('sourceId', 'sourceId', { unique: false })
        store.createIndex('artist', 'metadata.artist', { unique: false })
      }
    }
  })
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * IndexedDB-хранилище MediaIndex (offline-first).
 */
export class IndexedDbMediaIndexStorage implements MediaIndexStorage {
  async load(): Promise<TrackRecord[]> {
    try {
      const db = await openDb()
      try {
        const tx = db.transaction(STORE, 'readonly')
        const rows = await req(tx.objectStore(STORE).getAll())
        return (rows as TrackRecord[]) ?? []
      } finally {
        db.close()
      }
    } catch {
      return []
    }
  }

  async save(records: TrackRecord[]): Promise<void> {
    try {
      const db = await openDb()
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        store.clear()
        for (const record of records) {
          // Не персистим previewUrl (может быть blob:).
          const safe: TrackRecord = {
            ...record,
            track: { ...record.track, previewUrl: null },
          }
          store.put(safe)
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    } catch {
      // silent — Memory слой остаётся источником истины в сессии
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await openDb()
      try {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).clear()
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    } catch {
      // no-op
    }
  }
}
