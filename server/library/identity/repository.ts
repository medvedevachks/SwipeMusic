import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isUniqueConstraintError } from '../../auth/users.ts'
import type { LibraryResult } from '../repository.ts'
import type {
  CanonicalTrackDto,
  SourceCopyDto,
  SourceCopySnapshot,
  TrackIdentityDto,
} from './types.ts'

type CanonicalRow = {
  id: string
  title: string
  artist: string
  album: string | null
  duration_ms: number | null
  artwork_url: string | null
  created_at: string
  updated_at: string
}

type CopyRow = {
  source_track_key: string
  canonical_track_id: string
  source_id: string
  external_id: string
  title: string
  artist: string
  album: string | null
  duration_ms: number | null
  artwork_url: string | null
  created_at: string
  updated_at: string
}

type CollectionRow = {
  title: string
  artist: string
  album: string | null
  duration_ms: number | null
  cover_url: string | null
}

function failure(status: number, error: string): LibraryResult<never> {
  return { ok: false, status, error }
}

function sourceTrackKey(sourceId: string, externalId: string): string {
  return `${sourceId}:${externalId}`
}

function toCanonical(row: CanonicalRow): CanonicalTrackDto {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: row.duration_ms,
    artworkUrl: row.artwork_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toCopy(row: CopyRow): SourceCopyDto {
  return {
    sourceTrackKey: row.source_track_key,
    canonicalTrackId: row.canonical_track_id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: row.duration_ms,
    artworkUrl: row.artwork_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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

export function createIdentityRepository(db: DatabaseSync) {
  const copyByKey = db.prepare(`
    SELECT source_track_key, canonical_track_id, source_id, external_id,
           title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_track_source_copies
    WHERE user_id = ? AND source_track_key = ?
  `)
  const copiesByCanonical = db.prepare(`
    SELECT source_track_key, canonical_track_id, source_id, external_id,
           title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_track_source_copies
    WHERE user_id = ? AND canonical_track_id = ?
    ORDER BY created_at, source_track_key
  `)
  const canonicalById = db.prepare(`
    SELECT id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_canonical_tracks
    WHERE user_id = ? AND id = ?
  `)
  const collectionByTrack = db.prepare(`
    SELECT title, artist, album, duration_ms, cover_url
    FROM user_collection_tracks
    WHERE user_id = ? AND track_id = ?
  `)
  const insertCanonical = db.prepare(`
    INSERT INTO user_canonical_tracks (
      user_id, id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCopy = db.prepare(`
    INSERT INTO user_track_source_copies (
      user_id, source_track_key, canonical_track_id, source_id, external_id,
      title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const moveCopies = db.prepare(`
    UPDATE user_track_source_copies
    SET canonical_track_id = ?, updated_at = ?
    WHERE user_id = ? AND canonical_track_id = ?
  `)
  const touchCanonical = db.prepare(`
    UPDATE user_canonical_tracks SET updated_at = ? WHERE user_id = ? AND id = ?
  `)
  const deleteCanonical = db.prepare(`
    DELETE FROM user_canonical_tracks WHERE user_id = ? AND id = ?
  `)
  const retargetCopy = db.prepare(`
    UPDATE user_track_source_copies
    SET canonical_track_id = ?, updated_at = ?
    WHERE user_id = ? AND source_track_key = ?
  `)

  function readIdentity(userId: string, canonicalId: string): TrackIdentityDto | null {
    const canonical = canonicalById.get(userId, canonicalId) as CanonicalRow | undefined
    if (!canonical) {
      return null
    }
    const copies = (copiesByCanonical.all(userId, canonicalId) as CopyRow[]).map(toCopy)
    return { canonicalTrack: toCanonical(canonical), copies }
  }

  function readByKey(userId: string, key: string): TrackIdentityDto | null {
    const copy = copyByKey.get(userId, key) as CopyRow | undefined
    if (!copy) {
      return null
    }
    return readIdentity(userId, copy.canonical_track_id)
  }

  function insertPair(userId: string, snapshot: SourceCopySnapshot, now: string): string {
    const canonicalId = `can_${randomUUID()}`
    const key = sourceTrackKey(snapshot.sourceId, snapshot.externalId)
    insertCanonical.run(
      userId,
      canonicalId,
      snapshot.title,
      snapshot.artist,
      snapshot.album,
      snapshot.durationMs,
      snapshot.artworkUrl,
      now,
      now,
    )
    insertCopy.run(
      userId,
      key,
      canonicalId,
      snapshot.sourceId,
      snapshot.externalId,
      snapshot.title,
      snapshot.artist,
      snapshot.album,
      snapshot.durationMs,
      snapshot.artworkUrl,
      now,
      now,
    )
    return canonicalId
  }

  return {
    /**
     * Одна копия — один новый canonical. Чужие копии не ищет и не склеивает.
     */
    ensureSourceCopy(
      userId: string,
      snapshot: SourceCopySnapshot,
    ): LibraryResult<TrackIdentityDto> {
      const key = sourceTrackKey(snapshot.sourceId, snapshot.externalId)
      const existing = readByKey(userId, key)
      if (existing) {
        return { ok: true, value: existing }
      }
      const now = new Date().toISOString()
      let canonicalId: string
      try {
        canonicalId = withTransaction(db, () => insertPair(userId, snapshot, now))
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error
        }
        const raced = readByKey(userId, key)
        if (raced) {
          return { ok: true, value: raced }
        }
        throw error
      }
      const created = readIdentity(userId, canonicalId)
      if (!created) {
        return failure(500, 'INTERNAL')
      }
      return { ok: true, value: created }
    },

    /**
     * Если копии ещё нет, но трек уже лежит в коллекции, создаёт одну пару.
     * Без коллекции и без копии отвечает 404 и ничего не создаёт.
     */
    readOrBackfill(userId: string, key: string): LibraryResult<TrackIdentityDto> {
      const existing = readByKey(userId, key)
      if (existing) {
        return { ok: true, value: existing }
      }
      const row = collectionByTrack.get(userId, key) as CollectionRow | undefined
      if (!row) {
        return failure(404, 'NOT_FOUND')
      }
      const index = key.indexOf(':')
      return this.ensureSourceCopy(userId, {
        sourceId: key.slice(0, index),
        externalId: key.slice(index + 1),
        title: row.title,
        artist: row.artist,
        album: row.album,
        durationMs: row.duration_ms,
        artworkUrl: row.cover_url,
      })
    },

    linkSourceCopies(
      userId: string,
      keyA: string,
      keyB: string,
    ): LibraryResult<TrackIdentityDto> {
      const left = copyByKey.get(userId, keyA) as CopyRow | undefined
      const right = copyByKey.get(userId, keyB) as CopyRow | undefined
      if (!left || !right) {
        return failure(404, 'NOT_FOUND')
      }
      if (left.canonical_track_id === right.canonical_track_id) {
        const same = readIdentity(userId, left.canonical_track_id)
        return same ? { ok: true, value: same } : failure(404, 'NOT_FOUND')
      }

      const now = new Date().toISOString()
      const targetId = left.canonical_track_id
      const sourceId = right.canonical_track_id
      withTransaction(db, () => {
        moveCopies.run(targetId, now, userId, sourceId)
        touchCanonical.run(now, userId, targetId)
        deleteCanonical.run(userId, sourceId)
      })
      const merged = readIdentity(userId, targetId)
      if (!merged) {
        return failure(500, 'INTERNAL')
      }
      return { ok: true, value: merged }
    },

    /**
     * Отделяет копию на новый canonical. Единственная копия уже изолирована.
     */
    unlinkSourceCopy(userId: string, key: string): LibraryResult<TrackIdentityDto> {
      const copy = copyByKey.get(userId, key) as CopyRow | undefined
      if (!copy) {
        return failure(404, 'NOT_FOUND')
      }
      const siblings = copiesByCanonical.all(userId, copy.canonical_track_id) as CopyRow[]
      if (siblings.length <= 1) {
        const alone = readIdentity(userId, copy.canonical_track_id)
        return alone ? { ok: true, value: alone } : failure(404, 'NOT_FOUND')
      }

      const now = new Date().toISOString()
      const canonicalId = `can_${randomUUID()}`
      withTransaction(db, () => {
        insertCanonical.run(
          userId,
          canonicalId,
          copy.title,
          copy.artist,
          copy.album,
          copy.duration_ms,
          copy.artwork_url,
          now,
          now,
        )
        retargetCopy.run(canonicalId, now, userId, key)
      })
      const detached = readIdentity(userId, canonicalId)
      if (!detached) {
        return failure(500, 'INTERNAL')
      }
      return { ok: true, value: detached }
    },
  }
}
