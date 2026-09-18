import type { CollectionSnapshot, SyncOperation, SyncStatus } from '../types/sync'

const DB_NAME = 'swipe-music-collection'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode)
    const store = tx.objectStore('kv')
    const request = fn(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore('readonly', (store) => store.get(key))
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  await withStore('readwrite', (store) => store.put(value, key))
}

export type LocalCollectionRecord = {
  snapshot: CollectionSnapshot
  pending: SyncOperation[]
  status: SyncStatus
  lastError?: string
  ownerUserId?: string | null
}

const COLLECTION_KEY = 'collection'
const BACKUP_PREFIX = 'backup:'

export async function loadLocalCollection(): Promise<LocalCollectionRecord | undefined> {
  return idbGet<LocalCollectionRecord>(COLLECTION_KEY)
}

export async function saveLocalCollection(record: LocalCollectionRecord): Promise<void> {
  await idbSet(COLLECTION_KEY, record)
}

export async function backupLocalCollection(record: LocalCollectionRecord): Promise<string> {
  const key = `${BACKUP_PREFIX}${new Date().toISOString()}`
  await idbSet(key, record)
  return key
}
