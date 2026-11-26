import { snapshotFromTrack } from '../canonical/mapCanonical.ts'
import { libraryClient } from '../libraryPersistence/client.ts'
import { useAuthStore } from '../../store/authStore.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { Track } from '../../types/track.ts'

/** Размер пакета: ensure+upsert на сервере без зависания UI на больших коллекциях. */
export const SOURCE_FAVORITES_CHUNK = 50

export type SyncSourceFavoritesResult =
  | {
      status: 'synced'
      sourceId: string
      upserted: number
      pruned: number
    }
  | {
      status: 'skipped'
      reason: 'unauthenticated' | 'empty'
    }
  | {
      status: 'error'
      message: string
    }

/**
 * Импорт внешнего избранного в SQLite через CanonicalTrack/SourceCopy.
 * Не ставит state.liked и не добавляет в «Свайпы».
 * При ошибке mid-sync не вызывает finalize → ранее импортированные записи сохраняются.
 */
export async function syncSourceFavorites(input: {
  sourceId: string
  tracks: readonly Track[]
  signal?: AbortSignal
}): Promise<SyncSourceFavoritesResult> {
  const userId = useAuthStore.getState().user?.id ?? null
  if (!userId) {
    return { status: 'skipped', reason: 'unauthenticated' }
  }

  const sourceTracks = input.tracks.filter(
    (track) => track.sourceId === input.sourceId && Boolean(track.externalId),
  )
  const seenAt = new Date().toISOString()
  let upserted = 0
  let pruned = 0

  try {
    if (sourceTracks.length === 0) {
      // Пустое избранное источника: финализируем prune, если сессия есть.
      const empty = await libraryClient.syncSourceFavorites(input.sourceId, {
        snapshots: [],
        seenAt,
        finalize: true,
      })
      await reloadCanonicalLibrary(userId)
      return {
        status: 'synced',
        sourceId: input.sourceId,
        upserted: empty.upserted,
        pruned: empty.pruned,
      }
    }

    for (let offset = 0; offset < sourceTracks.length; offset += SOURCE_FAVORITES_CHUNK) {
      if (input.signal?.aborted) {
        return { status: 'error', message: 'aborted' }
      }
      const chunk = sourceTracks.slice(offset, offset + SOURCE_FAVORITES_CHUNK)
      const finalize = offset + SOURCE_FAVORITES_CHUNK >= sourceTracks.length
      const result = await libraryClient.syncSourceFavorites(input.sourceId, {
        snapshots: chunk.map(snapshotFromTrack),
        seenAt,
        finalize,
      })
      upserted += result.upserted
      pruned += result.pruned
    }

    await reloadCanonicalLibrary(userId)
    return {
      status: 'synced',
      sourceId: input.sourceId,
      upserted,
      pruned,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function reloadCanonicalLibrary(userId: string): Promise<void> {
  const payload = await libraryClient.loadCanonicalLibrary()
  useCanonicalLibraryStore.getState().replaceForUser(userId, payload.items)
}
