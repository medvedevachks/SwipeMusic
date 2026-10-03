import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LibraryResult } from '../repository.ts'
import type { CanonicalTrackDto, SourceCopyDto } from '../identity/types.ts'
import { mergeCanonicalUserState, neutralCanonicalState, stripCanonicalMetadata } from './state.ts'
import type { CanonicalLibraryItem, CanonicalMembership, CanonicalUserState } from './types.ts'

export const CANONICAL_LIBRARY_MIGRATION = 'canonical-library-v1'

type CollectionMigrationRow = {
  track_id: string
  source_id: string
  external_id: string
  title: string
  artist: string
  album: string | null
  duration_ms: number | null
  cover_url: string | null
  added_at: string
  last_played: string | null
  play_count: number
  liked: number
  liked_at: string | null
  disliked: number
  skipped: number
  notes: string
  favorite: number
  hidden: number
  custom_metadata_json: string
}

type StateRow = {
  canonical_track_id: string
  added_at: string
  last_played: string | null
  play_count: number
  liked: number
  liked_at: string | null
  disliked: number
  skipped: number
  notes: string
  favorite: number
  hidden: number
  custom_metadata_json: string
  updated_at: string
}

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

type AssignmentRow = {
  category_id: string
  track_id: string
  created_at: string
}

type MembershipRow = {
  catalog_id: string
  canonical_track_id: string
  created_at: string
}

function failure(status: number, error: string): LibraryResult<never> {
  return { ok: false, status, error }
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

function flag(value: boolean): number {
  return value ? 1 : 0
}

function isOn(value: number): boolean {
  return value === 1
}

function readMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

function stateFromCollection(row: CollectionMigrationRow): CanonicalUserState {
  const liked = isOn(row.liked)
  return {
    addedAt: row.added_at,
    lastPlayed: row.last_played,
    playCount: row.play_count,
    liked,
    likedAt: liked ? row.liked_at : null,
    disliked: liked ? false : isOn(row.disliked),
    skipped: row.skipped,
    notes: row.notes,
    favorite: isOn(row.favorite),
    hidden: isOn(row.hidden),
    customMetadata: readMetadata(row.custom_metadata_json),
  }
}

function stateFromRow(row: StateRow): CanonicalUserState {
  const liked = isOn(row.liked)
  return {
    addedAt: row.added_at,
    lastPlayed: row.last_played,
    playCount: row.play_count,
    liked,
    likedAt: liked ? row.liked_at : null,
    disliked: liked ? false : isOn(row.disliked),
    skipped: row.skipped,
    notes: row.notes,
    favorite: isOn(row.favorite),
    hidden: isOn(row.hidden),
    customMetadata: readMetadata(row.custom_metadata_json),
  }
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

export function createCanonicalLibraryRepository(db: DatabaseSync) {
  const marker = db.prepare(`
    SELECT migration_key FROM user_data_migrations
    WHERE user_id = ? AND migration_key = ?
  `)
  const insertMarker = db.prepare(`
    INSERT INTO user_data_migrations (user_id, migration_key, applied_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, migration_key) DO UPDATE SET applied_at = excluded.applied_at
  `)
  const collectionRows = db.prepare(`
    SELECT track_id, source_id, external_id, title, artist, album, duration_ms, cover_url,
           added_at, last_played, play_count, liked, liked_at, disliked, skipped, notes,
           favorite, hidden, custom_metadata_json
    FROM user_collection_tracks
    WHERE user_id = ?
      AND track_id NOT IN (
        SELECT track_id FROM user_collection_canonical_applied WHERE user_id = ?
      )
    ORDER BY added_at ASC, track_id ASC
  `)
  const pendingCount = db.prepare(`
    SELECT COUNT(*) AS n
    FROM user_collection_tracks
    WHERE user_id = ?
      AND track_id NOT IN (
        SELECT track_id FROM user_collection_canonical_applied WHERE user_id = ?
      )
  `)
  const insertApplied = db.prepare(`
    INSERT INTO user_collection_canonical_applied (user_id, track_id, applied_at)
    VALUES (?, ?, ?)
  `)
  const oldAssignments = db.prepare(`
    SELECT category_id, track_id, created_at
    FROM user_category_tracks
    WHERE user_id = ?
      AND track_id NOT IN (
        SELECT track_id FROM user_collection_canonical_applied WHERE user_id = ?
      )
    ORDER BY created_at ASC, id ASC
  `)
  const copyByKey = db.prepare(`
    SELECT canonical_track_id FROM user_track_source_copies
    WHERE user_id = ? AND source_track_key = ?
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
  const stateByCanonical = db.prepare(`
    SELECT canonical_track_id, added_at, last_played, play_count, liked, liked_at, disliked,
           skipped, notes, favorite, hidden, custom_metadata_json, updated_at
    FROM user_canonical_library_tracks
    WHERE user_id = ? AND canonical_track_id = ?
  `)
  const insertState = db.prepare(`
    INSERT INTO user_canonical_library_tracks (
      user_id, canonical_track_id, added_at, last_played, play_count, liked, liked_at,
      disliked, skipped, notes, favorite, hidden, custom_metadata_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateState = db.prepare(`
    UPDATE user_canonical_library_tracks
    SET added_at = ?, last_played = ?, play_count = ?, liked = ?, liked_at = ?,
        disliked = ?, skipped = ?, notes = ?, favorite = ?, hidden = ?,
        custom_metadata_json = ?, updated_at = ?
    WHERE user_id = ? AND canonical_track_id = ?
  `)
  const deleteState = db.prepare(`
    DELETE FROM user_canonical_library_tracks
    WHERE user_id = ? AND canonical_track_id = ?
  `)
  const insertMembership = db.prepare(`
    INSERT OR IGNORE INTO user_catalog_canonical_tracks (
      user_id, catalog_id, canonical_track_id, created_at
    ) VALUES (?, ?, ?, ?)
  `)
  const membershipsOf = db.prepare(`
    SELECT catalog_id, canonical_track_id, created_at
    FROM user_catalog_canonical_tracks
    WHERE user_id = ? AND canonical_track_id = ?
    ORDER BY created_at ASC, catalog_id ASC
  `)
  const deleteMemberships = db.prepare(`
    DELETE FROM user_catalog_canonical_tracks
    WHERE user_id = ? AND canonical_track_id = ?
  `)
  const membershipByPair = db.prepare(`
    SELECT catalog_id, canonical_track_id, created_at
    FROM user_catalog_canonical_tracks
    WHERE user_id = ? AND catalog_id = ? AND canonical_track_id = ?
  `)
  const deleteMembership = db.prepare(`
    DELETE FROM user_catalog_canonical_tracks
    WHERE user_id = ? AND catalog_id = ? AND canonical_track_id = ?
  `)
  const canonicalById = db.prepare(`
    SELECT id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_canonical_tracks
    WHERE user_id = ? AND id = ?
  `)
  const listCanonical = db.prepare(`
    SELECT id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_canonical_tracks
    WHERE user_id = ?
    ORDER BY created_at ASC, id ASC
  `)
  const copiesOf = db.prepare(`
    SELECT source_track_key, canonical_track_id, source_id, external_id,
           title, artist, album, duration_ms, artwork_url, created_at, updated_at
    FROM user_track_source_copies
    WHERE user_id = ? AND canonical_track_id = ?
    ORDER BY created_at ASC, source_track_key ASC
  `)
  const categoryById = db.prepare(`
    SELECT id FROM user_categories WHERE user_id = ? AND id = ?
  `)

  function writeState(userId: string, canonicalId: string, state: CanonicalUserState, now: string): void {
    const existing = stateByCanonical.get(userId, canonicalId) as StateRow | undefined
    const values = [
      state.addedAt,
      state.lastPlayed,
      state.playCount,
      flag(state.liked),
      state.liked ? state.likedAt : null,
      flag(state.disliked),
      state.skipped,
      state.notes,
      flag(state.favorite),
      flag(state.hidden),
      JSON.stringify(state.customMetadata),
      now,
    ]
    if (!existing) {
      insertState.run(userId, canonicalId, ...values)
      return
    }
    updateState.run(...values, userId, canonicalId)
  }

  function readItem(userId: string, canonicalId: string): CanonicalLibraryItem | null {
    const canonical = canonicalById.get(userId, canonicalId) as CanonicalRow | undefined
    if (!canonical) {
      return null
    }
    const copies = (copiesOf.all(userId, canonicalId) as CopyRow[]).map(toCopy)
    const stored = stateByCanonical.get(userId, canonicalId) as StateRow | undefined
    const state = stored ? stateFromRow(stored) : neutralCanonicalState(canonical.created_at)
    const catalogIds = (membershipsOf.all(userId, canonicalId) as MembershipRow[]).map(
      (row) => row.catalog_id,
    )
    return {
      canonicalTrack: toCanonical(canonical),
      copies,
      state: { ...state, customMetadata: stripCanonicalMetadata(state.customMetadata) },
      catalogIds,
    }
  }

  function applyMigration(userId: string, now: string): void {
    const tracks = collectionRows.all(userId, userId) as CollectionMigrationRow[]
    const canonicalOfTrack = new Map<string, string>()
    for (const track of tracks) {
      const existing = copyByKey.get(userId, track.track_id) as
        | { canonical_track_id: string }
        | undefined
      if (existing) {
        canonicalOfTrack.set(track.track_id, existing.canonical_track_id)
        continue
      }
      const canonicalId = `can_${randomUUID()}`
      insertCanonical.run(
        userId,
        canonicalId,
        track.title,
        track.artist,
        track.album,
        track.duration_ms,
        track.cover_url,
        now,
        now,
      )
      insertCopy.run(
        userId,
        track.track_id,
        canonicalId,
        track.source_id,
        track.external_id,
        track.title,
        track.artist,
        track.album,
        track.duration_ms,
        track.cover_url,
        now,
        now,
      )
      canonicalOfTrack.set(track.track_id, canonicalId)
    }

    const groups = new Map<string, CollectionMigrationRow[]>()
    for (const track of tracks) {
      const canonicalId = canonicalOfTrack.get(track.track_id)
      if (!canonicalId) continue
      const group = groups.get(canonicalId) ?? []
      group.push(track)
      groups.set(canonicalId, group)
    }

    for (const [canonicalId, group] of groups) {
      const sorted = [...group].sort((left, right) => {
        const byAdded = left.added_at.localeCompare(right.added_at)
        return byAdded === 0 ? left.track_id.localeCompare(right.track_id) : byAdded
      })
      let folded = stateFromCollection(sorted[0] as CollectionMigrationRow)
      for (const row of sorted.slice(1)) {
        folded = mergeCanonicalUserState(folded, stateFromCollection(row))
      }
      const existing = stateByCanonical.get(userId, canonicalId) as StateRow | undefined
      const next = existing ? mergeCanonicalUserState(stateFromRow(existing), folded) : folded
      writeState(userId, canonicalId, next, now)
    }

    for (const assignment of oldAssignments.all(userId, userId) as AssignmentRow[]) {
      const canonicalId = canonicalOfTrack.get(assignment.track_id)
      if (!canonicalId) continue
      insertMembership.run(userId, assignment.category_id, canonicalId, assignment.created_at)
    }
    for (const track of tracks) {
      insertApplied.run(userId, track.track_id, now)
    }
    insertMarker.run(userId, CANONICAL_LIBRARY_MIGRATION, now)
  }

  function settled(userId: string): boolean {
    if (!marker.get(userId, CANONICAL_LIBRARY_MIGRATION)) {
      return false
    }
    const pending = pendingCount.get(userId, userId) as { n: number }
    return pending.n === 0
  }

  return {
    migrate(userId: string): void {
      if (settled(userId)) {
        return
      }
      const now = new Date().toISOString()
      withTransaction(db, () => {
        if (settled(userId)) {
          return
        }
        applyMigration(userId, now)
      })
    },

    list(userId: string): CanonicalLibraryItem[] {
      this.migrate(userId)
      return (listCanonical.all(userId) as CanonicalRow[])
        .map((row) => readItem(userId, row.id))
        .filter((item): item is CanonicalLibraryItem => item !== null)
    },

    patchLiked(
      userId: string,
      canonicalId: string,
      liked: boolean,
    ): LibraryResult<CanonicalLibraryItem> {
      this.migrate(userId)
      if (!canonicalById.get(userId, canonicalId)) {
        return failure(404, 'NOT_FOUND')
      }
      const now = new Date().toISOString()
      const current = stateByCanonical.get(userId, canonicalId) as StateRow | undefined
      const base = current ? stateFromRow(current) : neutralCanonicalState(now)
      const next: CanonicalUserState = {
        ...base,
        liked,
        likedAt: liked ? (base.liked ? base.likedAt : now) : null,
        disliked: liked ? false : base.disliked,
      }
      writeState(userId, canonicalId, next, now)
      const item = readItem(userId, canonicalId)
      if (!item) {
        return failure(404, 'NOT_FOUND')
      }
      return { ok: true, value: item }
    },

    assign(
      userId: string,
      catalogId: string,
      canonicalId: string,
    ): LibraryResult<CanonicalMembership> {
      this.migrate(userId)
      if (!categoryById.get(userId, catalogId) || !canonicalById.get(userId, canonicalId)) {
        return failure(404, 'NOT_FOUND')
      }
      const existing = membershipByPair.get(userId, catalogId, canonicalId) as MembershipRow | undefined
      if (existing) {
        return {
          ok: true,
          value: {
            catalogId: existing.catalog_id,
            canonicalTrackId: existing.canonical_track_id,
            createdAt: existing.created_at,
          },
        }
      }
      const now = new Date().toISOString()
      insertMembership.run(userId, catalogId, canonicalId, now)
      return {
        ok: true,
        value: { catalogId, canonicalTrackId: canonicalId, createdAt: now },
      }
    },

    unassign(
      userId: string,
      catalogId: string,
      canonicalId: string,
    ): LibraryResult<{ ok: true }> {
      this.migrate(userId)
      if (!categoryById.get(userId, catalogId) || !canonicalById.get(userId, canonicalId)) {
        return failure(404, 'NOT_FOUND')
      }
      const removed = deleteMembership.run(userId, catalogId, canonicalId)
      if (Number(removed.changes) === 0) {
        return failure(404, 'NOT_FOUND')
      }
      return { ok: true, value: { ok: true } }
    },

    /**
     * Переносит состояние и членство canonical source в target.
     * Вызывается внутри уже открытой транзакции link.
     */
    absorbCanonical(userId: string, targetId: string, sourceId: string, now: string): void {
      const target = stateByCanonical.get(userId, targetId) as StateRow | undefined
      const source = stateByCanonical.get(userId, sourceId) as StateRow | undefined
      if (target && source) {
        writeState(
          userId,
          targetId,
          mergeCanonicalUserState(stateFromRow(target), stateFromRow(source)),
          now,
        )
        deleteState.run(userId, sourceId)
      } else if (source) {
        const moved = stateFromRow(source)
        deleteState.run(userId, sourceId)
        writeState(userId, targetId, moved, now)
      }

      for (const row of membershipsOf.all(userId, sourceId) as MembershipRow[]) {
        insertMembership.run(userId, row.catalog_id, targetId, row.created_at)
      }
      deleteMemberships.run(userId, sourceId)
    },

    /**
     * Нейтральное состояние отделённой копии. Каталоги не копируются.
     * Вызывается внутри уже открытой транзакции unlink.
     */
    attachNeutralState(userId: string, canonicalId: string, now: string): void {
      if (stateByCanonical.get(userId, canonicalId)) {
        return
      }
      writeState(userId, canonicalId, neutralCanonicalState(now), now)
    },
  }
}
