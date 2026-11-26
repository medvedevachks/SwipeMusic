import type { DatabaseSync } from 'node:sqlite'
import type { LibraryResult } from '../repository.ts'
import { createIdentityRepository } from '../identity/repository.ts'
import { createCanonicalLibraryRepository } from '../canonical/repository.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'
import type { SourceFavoritesSyncResult } from './types.ts'

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

/**
 * Зеркало внешнего избранного: отдельно от state.liked, привязка userId+sourceId.
 * Не пишет в sys_swipes и не трогает пользовательские лайки/каталоги.
 */
export function createSourceFavoritesRepository(db: DatabaseSync) {
  const identity = createIdentityRepository(db)
  const canonicalLibrary = createCanonicalLibraryRepository(db)

  const upsertFavorite = db.prepare(`
    INSERT INTO user_source_favorites (
      user_id, source_id, external_id, source_track_key, canonical_track_id,
      imported_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_id, external_id) DO UPDATE SET
      source_track_key = excluded.source_track_key,
      canonical_track_id = excluded.canonical_track_id,
      last_seen_at = excluded.last_seen_at
  `)
  const existingImportedAt = db.prepare(`
    SELECT imported_at FROM user_source_favorites
    WHERE user_id = ? AND source_id = ? AND external_id = ?
  `)
  const pruneStale = db.prepare(`
    DELETE FROM user_source_favorites
    WHERE user_id = ? AND source_id = ? AND last_seen_at < ?
  `)
  const retargetCanonical = db.prepare(`
    UPDATE user_source_favorites
    SET canonical_track_id = ?
    WHERE user_id = ? AND canonical_track_id = ?
  `)

  return {
    /** Перенос зеркала при склейке canonical (внутри внешней транзакции link). */
    retargetCanonicalFavorites(
      userId: string,
      targetCanonicalId: string,
      sourceCanonicalId: string,
    ): void {
      retargetCanonical.run(targetCanonicalId, userId, sourceCanonicalId)
    },

    sync(
      userId: string,
      sourceId: string,
      input: {
        snapshots: SourceCopySnapshot[]
        seenAt: string
        finalize: boolean
      },
    ): LibraryResult<SourceFavoritesSyncResult> {
      canonicalLibrary.migrate(userId)
      for (const snapshot of input.snapshots) {
        if (snapshot.sourceId !== sourceId) {
          return failure(400, 'VALIDATION')
        }
      }

      // ensureSourceCopy сам открывает транзакцию — вне batch-транзакции upsert.
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

      let upserted = 0
      let pruned = 0
      withTransaction(db, () => {
        for (const row of prepared) {
          const existing = existingImportedAt.get(
            userId,
            sourceId,
            row.snapshot.externalId,
          ) as { imported_at: string } | undefined
          const importedAt = existing?.imported_at ?? input.seenAt
          upsertFavorite.run(
            userId,
            sourceId,
            row.snapshot.externalId,
            row.key,
            row.canonicalId,
            importedAt,
            input.seenAt,
          )
          upserted += 1
        }
        if (input.finalize) {
          const removed = pruneStale.run(userId, sourceId, input.seenAt)
          pruned = Number(removed.changes) || 0
        }
      })

      // Клиент после sync перезагружает canonical-library; items не дублируем здесь.
      return {
        ok: true,
        value: {
          sourceId,
          upserted,
          pruned,
          items: [],
        },
      }
    },
  }
}

export type SourceFavoritesRepository = ReturnType<typeof createSourceFavoritesRepository>
