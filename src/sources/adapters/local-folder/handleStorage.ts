import type { LocalLibrarySnapshot } from './types'

const DB_NAME = 'swipe-music-local-library'
const DB_VERSION = 1
const HANDLE_STORE = 'handles'
const META_STORE = 'meta'
const ROOT_HANDLE_KEY = 'directory'
const SNAPSHOT_KEY = 'snapshot'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open local library DB'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    await idbRequest(tx.objectStore(HANDLE_STORE).put(handle, ROOT_HANDLE_KEY))
  } finally {
    db.close()
  }
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const value = await idbRequest(
      tx.objectStore(HANDLE_STORE).get(ROOT_HANDLE_KEY),
    )
    return (value as FileSystemDirectoryHandle | undefined) ?? null
  } finally {
    db.close()
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    await idbRequest(tx.objectStore(HANDLE_STORE).delete(ROOT_HANDLE_KEY))
  } finally {
    db.close()
  }
}

export async function saveLibrarySnapshot(
  snapshot: LocalLibrarySnapshot,
): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    await idbRequest(tx.objectStore(META_STORE).put(snapshot, SNAPSHOT_KEY))
  } finally {
    db.close()
  }
}

export async function loadLibrarySnapshot(): Promise<LocalLibrarySnapshot | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, 'readonly')
    const value = await idbRequest(tx.objectStore(META_STORE).get(SNAPSHOT_KEY))
    return (value as LocalLibrarySnapshot | undefined) ?? null
  } finally {
    db.close()
  }
}

export async function clearLibrarySnapshot(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    await idbRequest(tx.objectStore(META_STORE).delete(SNAPSHOT_KEY))
  } finally {
    db.close()
  }
}

export async function clearLocalLibraryStorage(): Promise<void> {
  await clearDirectoryHandle()
  await clearLibrarySnapshot()
}
