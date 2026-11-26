import {
  captureAuthSession,
  isAuthSessionCurrent,
  StaleLibrarySessionError,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'
import { snapshotFromTrack } from '../canonical/mapCanonical.ts'
import { LibraryHttpError, libraryClient } from '../libraryPersistence/client.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { Track } from '../../types/track.ts'

/** Размер пакета: ensure+upsert на сервере без зависания UI на больших коллекциях. */
export const SOURCE_FAVORITES_CHUNK = 50

export type SyncSourceFavoritesResult =
  | {
      status: 'synced'
      sourceId: string
      syncId: string
      upserted: number
      pruned: number
    }
  | {
      status: 'skipped'
      reason: 'unauthenticated' | 'list-incomplete'
    }
  | {
      status: 'error'
      message: string
    }

export type SourceFavoritesBatchSource = {
  /**
   * Полный список refs/треков успешно получен с API (в т.ч. пустой).
   * false при ошибке загрузки — sync/prune не запускаются.
   */
  listComplete: boolean
  /** Поток батчей уже замапленных Track; не обязан держать всю коллекцию в памяти. */
  batches: AsyncIterable<readonly Track[]>
}

function assertSession(session: AuthSessionSnapshot): void {
  if (!isAuthSessionCurrent(session) || !session.userId) {
    throw new StaleLibrarySessionError()
  }
}

/**
 * Импорт внешнего избранного через серверный syncId.
 * Не ставит state.liked и не добавляет в «Свайпы».
 * Смена auth-сессии прерывает импорт без записи в store другого пользователя.
 */
export async function syncSourceFavorites(input: {
  sourceId: string
  source: SourceFavoritesBatchSource
  signal?: AbortSignal
}): Promise<SyncSourceFavoritesResult> {
  const session = captureAuthSession()
  if (!session.userId) {
    return { status: 'skipped', reason: 'unauthenticated' }
  }
  if (!input.source.listComplete) {
    return { status: 'skipped', reason: 'list-incomplete' }
  }

  let upserted = 0
  let pruned = 0
  let syncId: string | null = null

  try {
    assertSession(session)
    if (input.signal?.aborted) {
      return { status: 'error', message: 'aborted' }
    }

    const started = await libraryClient.startSourceFavoritesSync(input.sourceId)
    assertSession(session)
    syncId = started.syncId

    for await (const batch of input.source.batches) {
      assertSession(session)
      if (input.signal?.aborted) {
        return { status: 'error', message: 'aborted' }
      }
      const snapshots = batch
        .filter((track) => track.sourceId === input.sourceId && Boolean(track.externalId))
        .map(snapshotFromTrack)
      if (snapshots.length === 0) {
        continue
      }
      for (let offset = 0; offset < snapshots.length; offset += SOURCE_FAVORITES_CHUNK) {
        assertSession(session)
        const chunk = snapshots.slice(offset, offset + SOURCE_FAVORITES_CHUNK)
        const result = await libraryClient.upsertSourceFavoritesChunk(input.sourceId, {
          syncId,
          snapshots: chunk,
        })
        assertSession(session)
        upserted += result.upserted
      }
    }

    assertSession(session)
    const completed = await libraryClient.completeSourceFavoritesSync(input.sourceId, {
      syncId,
    })
    assertSession(session)
    pruned = completed.pruned

    await reloadCanonicalLibrary(session)
    return {
      status: 'synced',
      sourceId: input.sourceId,
      syncId,
      upserted,
      pruned,
    }
  } catch (error) {
    if (error instanceof StaleLibrarySessionError) {
      return { status: 'error', message: 'auth-session-changed' }
    }
    if (error instanceof LibraryHttpError && error.status === 409) {
      return { status: 'error', message: 'stale-sync' }
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Удобный вход для уже собранного массива (тесты / мелкие коллекции).
 * Для больших Yandex-библиотек предпочтителен streaming source.
 */
export async function syncSourceFavoritesFromTracks(input: {
  sourceId: string
  tracks: readonly Track[]
  listComplete?: boolean
  signal?: AbortSignal
}): Promise<SyncSourceFavoritesResult> {
  const tracks = input.tracks.filter(
    (track) => track.sourceId === input.sourceId && Boolean(track.externalId),
  )
  return syncSourceFavorites({
    sourceId: input.sourceId,
    signal: input.signal,
    source: {
      listComplete: input.listComplete !== false,
      batches: (async function* () {
        if (tracks.length === 0) {
          return
        }
        yield tracks
      })(),
    },
  })
}

async function reloadCanonicalLibrary(session: AuthSessionSnapshot): Promise<void> {
  assertSession(session)
  const userId = session.userId!
  const payload = await libraryClient.loadCanonicalLibrary()
  assertSession(session)
  if (session.userId !== userId) {
    throw new StaleLibrarySessionError()
  }
  useCanonicalLibraryStore.getState().replaceForUser(userId, payload.items)
}
