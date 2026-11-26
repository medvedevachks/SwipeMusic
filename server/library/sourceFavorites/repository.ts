import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LibraryResult } from '../repository.ts'
import { createIdentityRepository } from '../identity/repository.ts'
import { createCanonicalLibraryRepository } from '../canonical/repository.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'
import type {
  SourceFavoritesSyncChunkResult,
  SourceFavoritesSyncCompleteResult,
  SourceFavoritesSyncStartResult,
} from './types.ts'

function failure(status: number, error: string): LibraryResult<never> {
  return { ok: false, status, error }
}

function sourceTrackKey(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`
}

function withTransaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = run()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type SyncRow = {
  sync_id: string
  status: string
  started_at: string
}

/**
 * Зеркало внешнего избранного: отдельно от state.liked, привязка userId+sourceId.
 * Prune только для активного серверного syncId.
 */
export function createSourceFavoritesRepository(db: DatabaseSync) {
  const identity = createIdentityRepository(db)
  const canonicalLibrary = createCanonicalLibraryRepository(db)

  const insertSync = db.prepare(`
    INSERT INTO user_source_favorite_syncs (
      user_id, source_id, sync_id, started_at, status
    ) VALUES (?, ?, ?, ?, 'open')
  `)
  const supersedeOpen = db.prepare(`
    UPDATE user_source_favorite_syncs
    SET status = 'superseded'
    WHERE user_id = ? AND source_id = ? AND status = 'open'
  `)
  const readSync = db.prepare(`
    SELECT sync_id, status, started_at
    FROM user_source_favorite_syncs
    WHERE user_id = ? AND source_id = ? AND sync_id = ?
  `)
  const completeSync = db.prepare(`
    UPDATE user_source_favorite_syncs
    SET status = 'completed'
    WHERE user_id = ? AND source_id = ? AND sync_id = ? AND status = 'open'
  `)

  const upsertFavorite = db.prepare(`
    INSERT INTO user_source_favorites (
      user_id, source_id, external_id, source_track_key, canonical_track_id,
      imported_at, last_seen_at, sync_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_id, external_id) DO UPDATE SET
      source_track_key = excluded.source_track_key,
      canonical_track_id = excluded.canonical_track_id,
      last_seen_at = excluded.last_seen_at,
      sync_id = excluded.sync_id
  `)
  const existingImportedAt = db.prepare(`
    SELECT imported_at FROM user_source_favorites
    WHERE user_id = ? AND source_id = ? AND external_id = ?
  `)
  const pruneNotInSync = db.prepare(`
    DELETE FROM user_source_favorites
    WHERE user_id = ? AND source_id = ?
      AND (sync_id IS NULL OR sync_id != ?)
  `)
  const retargetCanonical = db.prepare(`
    UPDATE user_source_favorites
    SET canonical_track_id = ?
    WHERE user_id = ? AND canonical_track_id = ?
  `)

  function requireOpenSync(
    userId: string,
    sourceId: string,
    syncId: string,
  ): LibraryResult<SyncRow> {
    const row = readSync.get(userId, sourceId, syncId) as SyncRow | undefined
    if (!row) {
      return failure(404, 'SYNC_NOT_FOUND')
    }
    if (row.status !== 'open') {
      return failure(409, 'STALE_SYNC')
    }
    return { ok: true, value: row }
  }

  return {
    retargetCanonicalFavorites(
      userId: string,
      targetCanonicalId: string,
      sourceCanonicalId: string,
    ): void {
      retargetCanonical.run(targetCanonicalId, userId, sourceCanonicalId)
    },

    start(userId: string, sourceId: string): LibraryResult<SourceFavoritesSyncStartResult> {
      canonicalLibrary.migrate(userId)
      const startedAt = new Date().toISOString()
      const syncId = `sync_${randomUUID()}`
      withTransaction(db, () => {
        supersedeOpen.run(userId, sourceId)
        insertSync.run(userId, sourceId, syncId, startedAt)
      })
      return {
        ok: true,
        value: { sourceId, syncId, startedAt },
      }
    },

    upsertChunk(
      userId: string,
      sourceId: string,
      input: { syncId: string; snapshots: SourceCopySnapshot[] },
    ): LibraryResult<SourceFavoritesSyncChunkResult> {
      canonicalLibrary.migrate(userId)
      const open = requireOpenSync(userId, sourceId, input.syncId)
      if (!open.ok) {
        return open
      }
      for (const snapshot of input.snapshots) {
        if (snapshot.sourceId !== sourceId) {
          return failure(400, 'VALIDATION')
        }
      }

      const prepared: Array<{
        snapshot: SourceCopySnapshot
        canonicalId: string
        key: string
      }> = []
      for (const snapshot of input.snapshots) {
        const ensured = identity.ensureSourceCopy(userId, snapshot)
        if (!ensured.ok) {
          return failure(ensured.status, ensured.error)
        }
        prepared.push({
          snapshot,
          canonicalId: ensured.value.canonicalTrack.id,
          key: sourceTrackKey(snapshot.sourceId, snapshot.externalId),
        })
      }

      const seenAt = new Date().toISOString()
      let upserted = 0
      const write = withTransaction(db, () => {
        const stillOpen = requireOpenSync(userId, sourceId, input.syncId)
        if (!stillOpen.ok) {
          return stillOpen
        }
        for (const row of prepared) {
          const existing = existingImportedAt.get(
            userId,
            sourceId,
            row.snapshot.externalId,
          ) as { imported_at: string } | undefined
          const importedAt = existing?.imported_at ?? seenAt
          upsertFavorite.run(
            userId,
            sourceId,
            row.snapshot.externalId,
            row.key,
            row.canonicalId,
            importedAt,
            seenAt,
            input.syncId,
          )
          upserted += 1
        }
        return { ok: true as const, value: null }
      })
      if (!write.ok) {
        return write
      }

      return {
        ok: true,
        value: {
          sourceId,
          syncId: input.syncId,
          upserted,
        },
      }
    },

    complete(
      userId: string,
      sourceId: string,
      syncId: string,
    ): LibraryResult<SourceFavoritesSyncCompleteResult> {
      canonicalLibrary.migrate(userId)
      const result = withTransaction(db, () => {
        const open = requireOpenSync(userId, sourceId, syncId)
        if (!open.ok) {
          return open
        }
        const removed = pruneNotInSync.run(userId, sourceId, syncId)
        const completed = completeSync.run(userId, sourceId, syncId)
        if (Number(completed.changes) === 0) {
          return failure(409, 'STALE_SYNC')
        }
        return {
          ok: true as const,
          value: {
            sourceId,
            syncId,
            pruned: Number(removed.changes) || 0,
          },
        }
      })
      return result
    },
  }
}

export type SourceFavoritesRepository = ReturnType<typeof createSourceFavoritesRepository>
