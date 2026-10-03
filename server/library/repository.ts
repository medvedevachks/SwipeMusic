import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isUniqueConstraintError } from '../auth/users.ts'
import type {
  AssignmentDto,
  CategoryDto,
  CollectionTrackDto,
  GestureConfig,
  HistoryEntryDto,
  LibraryStateDto,
  TrackSnapshot,
  UserSettingsDto,
} from './types.ts'
import { DEFAULT_GESTURE_CONFIG } from './types.ts'
import type { CategoryPatch, CategoryWrite, HistoryWrite, TrackWrite } from './validation.ts'

type Failure = {
  ok: false
  status: number
  error: string
  fields?: Record<string, string>
}

type Success<T> = { ok: true; value: T }

export type LibraryResult<T> = Success<T> | Failure

type CategoryRow = {
  id: string
  name: string
  icon: CategoryDto['icon']
  color: string
  description: string
  created_at: string
  updated_at: string
  sort_order: number
  favorite: number
  system: number
}

type TrackRow = {
  track_id: string
  source_id: string
  external_id: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  duration_ms: number | null
  cover_url: string | null
  cover_color: string | null
  preview_url: string | null
  tags_json: string
  added_at: string
  updated_at: string
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

type AssignmentRow = {
  id: string
  track_id: string
  category_id: string
  created_at: string
}

type HistoryRow = {
  id: string
  track_id: string
  source_id: string
  action: HistoryEntryDto['action']
  category_id: string | null
  category_json: string | null
  track_json: string
  created_at: string
}

function failure(status: number, error: string, fields?: Record<string, string>): Failure {
  return { ok: false, status, error, fields }
}

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // транзакция уже закрыта
    }
    throw error
  }
}

function flag(value: boolean): number {
  return value ? 1 : 0
}

function toCategory(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    favorite: row.favorite === 1,
    system: row.system === 1,
  }
}

function toAssignment(row: AssignmentRow): AssignmentDto {
  return {
    id: row.id,
    trackId: row.track_id,
    categoryId: row.category_id,
    createdAt: row.created_at,
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toTrackSnapshot(row: TrackRow): TrackSnapshot {
  const track: TrackSnapshot = {
    id: row.track_id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    artist: row.artist,
  }
  if (row.album) track.album = row.album
  if (row.genre) track.genre = row.genre
  if (row.year != null) track.year = row.year
  if (row.duration_ms != null) track.durationMs = row.duration_ms
  if (row.cover_url) track.coverUrl = row.cover_url
  if (row.cover_color) track.coverColor = row.cover_color
  if (row.preview_url) track.previewUrl = row.preview_url
  const tags = parseJson<string[]>(row.tags_json, [])
  if (tags.length > 0) track.tags = tags
  return track
}

function toCollectionTrack(row: TrackRow, categories: string[]): CollectionTrackDto {
  return {
    trackId: row.track_id,
    sourceId: row.source_id,
    track: toTrackSnapshot(row),
    addedAt: row.added_at,
    lastPlayed: row.last_played,
    playCount: row.play_count,
    liked: row.liked === 1,
    likedAt: row.liked_at,
    disliked: row.disliked === 1,
    skipped: row.skipped,
    categories,
    notes: row.notes,
    favorite: row.favorite === 1,
    hidden: row.hidden === 1,
    customMetadata: parseJson<Record<string, unknown>>(row.custom_metadata_json, {}),
  }
}

function toHistory(row: HistoryRow): HistoryEntryDto {
  const entry: HistoryEntryDto = {
    id: row.id,
    track: parseJson<TrackSnapshot>(row.track_json, {
      id: row.track_id,
      sourceId: row.source_id,
      externalId: '',
      title: '',
      artist: '',
    }),
    action: row.action,
    createdAt: row.created_at,
    sourceId: row.source_id,
  }
  if (row.category_json) {
    const category = parseJson<CategoryDto | null>(row.category_json, null)
    if (category && typeof category === 'object') {
      entry.category = category
    }
  }
  return entry
}

export function createLibraryRepository(db: DatabaseSync) {
  const categoryById = db.prepare(`
    SELECT id, name, icon, color, description, created_at, updated_at, sort_order, favorite, system
    FROM user_categories WHERE user_id = ? AND id = ?
  `)
  const listCategoriesStmt = db.prepare(`
    SELECT id, name, icon, color, description, created_at, updated_at, sort_order, favorite, system
    FROM user_categories WHERE user_id = ?
    ORDER BY sort_order ASC, created_at ASC, id ASC
  `)
  const nextSortStmt = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order
    FROM user_categories WHERE user_id = ?
  `)
  const insertCategory = db.prepare(`
    INSERT INTO user_categories (
      user_id, id, name, icon, color, description, created_at, updated_at, sort_order, favorite, system
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateCategoryStmt = db.prepare(`
    UPDATE user_categories
    SET name = ?, icon = ?, color = ?, description = ?, updated_at = ?, sort_order = ?, favorite = ?
    WHERE user_id = ? AND id = ?
  `)
  const deleteCategoryStmt = db.prepare(`
    DELETE FROM user_categories WHERE user_id = ? AND id = ?
  `)
  const trackById = db.prepare(`
    SELECT track_id, source_id, external_id, title, artist, album, genre, year, duration_ms,
      cover_url, cover_color, preview_url, tags_json, added_at, updated_at, last_played,
      play_count, liked, liked_at, disliked, skipped, notes, favorite, hidden, custom_metadata_json
    FROM user_collection_tracks WHERE user_id = ? AND track_id = ?
  `)
  const listTracksStmt = db.prepare(`
    SELECT track_id, source_id, external_id, title, artist, album, genre, year, duration_ms,
      cover_url, cover_color, preview_url, tags_json, added_at, updated_at, last_played,
      play_count, liked, liked_at, disliked, skipped, notes, favorite, hidden, custom_metadata_json
    FROM user_collection_tracks WHERE user_id = ?
    ORDER BY added_at DESC, track_id ASC
  `)
  const upsertTrackStmt = db.prepare(`
    INSERT INTO user_collection_tracks (
      user_id, track_id, source_id, external_id, title, artist, album, genre, year, duration_ms,
      cover_url, cover_color, preview_url, tags_json, added_at, updated_at, last_played,
      play_count, liked, liked_at, disliked, skipped, notes, favorite, hidden, custom_metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, track_id) DO UPDATE SET
      source_id = excluded.source_id,
      external_id = excluded.external_id,
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      genre = excluded.genre,
      year = excluded.year,
      duration_ms = excluded.duration_ms,
      cover_url = excluded.cover_url,
      cover_color = excluded.cover_color,
      preview_url = excluded.preview_url,
      tags_json = excluded.tags_json,
      added_at = excluded.added_at,
      updated_at = excluded.updated_at,
      last_played = excluded.last_played,
      play_count = excluded.play_count,
      liked = excluded.liked,
      liked_at = excluded.liked_at,
      disliked = excluded.disliked,
      skipped = excluded.skipped,
      notes = excluded.notes,
      favorite = excluded.favorite,
      hidden = excluded.hidden,
      custom_metadata_json = excluded.custom_metadata_json
  `)
  const deleteTrackStmt = db.prepare(`
    DELETE FROM user_collection_tracks WHERE user_id = ? AND track_id = ?
  `)
  const listAssignmentsStmt = db.prepare(`
    SELECT id, track_id, category_id, created_at
    FROM user_category_tracks WHERE user_id = ?
    ORDER BY created_at ASC, id ASC
  `)
  const assignmentsForTrack = db.prepare(`
    SELECT id, track_id, category_id, created_at
    FROM user_category_tracks WHERE user_id = ? AND track_id = ?
    ORDER BY created_at ASC, id ASC
  `)
  const assignmentByPair = db.prepare(`
    SELECT id, track_id, category_id, created_at
    FROM user_category_tracks WHERE user_id = ? AND category_id = ? AND track_id = ?
  `)
  const assignmentById = db.prepare(`
    SELECT id FROM user_category_tracks WHERE user_id = ? AND id = ?
  `)
  const insertAssignment = db.prepare(`
    INSERT INTO user_category_tracks (user_id, id, category_id, track_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const deleteAssignmentPair = db.prepare(`
    DELETE FROM user_category_tracks WHERE user_id = ? AND category_id = ? AND track_id = ?
  `)
  const deleteAllTrackAssignments = db.prepare(`
    DELETE FROM user_category_tracks WHERE user_id = ? AND track_id = ?
  `)
  const insertHistory = db.prepare(`
    INSERT INTO user_history (
      user_id, id, track_id, source_id, action, category_id, category_json, track_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const historyById = db.prepare(`
    SELECT id, track_id, source_id, action, category_id, category_json, track_json, created_at
    FROM user_history WHERE user_id = ? AND id = ?
  `)
  const listHistoryStmt = db.prepare(`
    SELECT id, track_id, source_id, action, category_id, category_json, track_json, created_at
    FROM user_history WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `)
  const settingsByUser = db.prepare(`
    SELECT gesture_config_json FROM user_settings WHERE user_id = ?
  `)
  const upsertSettings = db.prepare(`
    INSERT INTO user_settings (user_id, gesture_config_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      gesture_config_json = excluded.gesture_config_json,
      updated_at = excluded.updated_at
  `)

  function categoriesOf(userId: string, trackId: string): string[] {
    const rows = assignmentsForTrack.all(userId, trackId) as AssignmentRow[]
    return rows.map((row) => row.category_id)
  }

  function readTrack(userId: string, trackId: string): CollectionTrackDto | null {
    const row = trackById.get(userId, trackId) as TrackRow | undefined
    return row ? toCollectionTrack(row, categoriesOf(userId, trackId)) : null
  }

  function readSettings(userId: string): UserSettingsDto {
    const row = settingsByUser.get(userId) as { gesture_config_json: string } | undefined
    if (!row) {
      return { gestureConfig: { ...DEFAULT_GESTURE_CONFIG } }
    }
    return {
      gestureConfig: parseJson<GestureConfig>(row.gesture_config_json, {
        ...DEFAULT_GESTURE_CONFIG,
      }),
    }
  }

  function listHistory(userId: string, limit: number): HistoryEntryDto[] {
    const rows = listHistoryStmt.all(userId, limit) as HistoryRow[]
    return rows.reverse().map(toHistory)
  }

  return {
    listCategories(userId: string): CategoryDto[] {
      return (listCategoriesStmt.all(userId) as CategoryRow[]).map(toCategory)
    },

    createCategory(userId: string, input: CategoryWrite): LibraryResult<CategoryDto> {
      const now = new Date().toISOString()
      const id = input.id ?? `cat_${randomUUID()}`
      if (categoryById.get(userId, id)) {
        return failure(409, 'CATEGORY_EXISTS')
      }
      const sortRow = nextSortStmt.get(userId) as { sort_order: number }
      const sortOrder = input.sortOrder ?? sortRow.sort_order
      const createdAt = input.createdAt ?? now
      const updatedAt = input.updatedAt ?? createdAt
      try {
        insertCategory.run(
          userId,
          id,
          input.name,
          input.icon,
          input.color,
          input.description,
          createdAt,
          updatedAt,
          sortOrder,
          flag(input.favorite),
          flag(input.system),
        )
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return failure(409, 'CATEGORY_EXISTS')
        }
        throw error
      }
      const created = categoryById.get(userId, id) as CategoryRow
      return { ok: true, value: toCategory(created) }
    },

    updateCategory(
      userId: string,
      id: string,
      patch: CategoryPatch,
    ): LibraryResult<CategoryDto> {
      const current = categoryById.get(userId, id) as CategoryRow | undefined
      if (!current) {
        return failure(404, 'NOT_FOUND')
      }
      const updatedAt = patch.updatedAt ?? new Date().toISOString()
      updateCategoryStmt.run(
        patch.name ?? current.name,
        patch.icon ?? current.icon,
        patch.color ?? current.color,
        patch.description ?? current.description,
        updatedAt,
        patch.sortOrder ?? current.sort_order,
        flag(patch.favorite ?? current.favorite === 1),
        userId,
        id,
      )
      const updated = categoryById.get(userId, id) as CategoryRow
      return { ok: true, value: toCategory(updated) }
    },

    deleteCategory(userId: string, id: string): LibraryResult<{ ok: true }> {
      const current = categoryById.get(userId, id) as CategoryRow | undefined
      if (!current) {
        return failure(404, 'NOT_FOUND')
      }
      if (current.system === 1) {
        return failure(409, 'SYSTEM_CATEGORY')
      }
      deleteCategoryStmt.run(userId, id)
      return { ok: true, value: { ok: true } }
    },

    listTracks(userId: string): CollectionTrackDto[] {
      const assignments = listAssignmentsStmt.all(userId) as AssignmentRow[]
      const byTrack = new Map<string, string[]>()
      for (const row of assignments) {
        const list = byTrack.get(row.track_id) ?? []
        list.push(row.category_id)
        byTrack.set(row.track_id, list)
      }
      return (listTracksStmt.all(userId) as TrackRow[]).map((row) =>
        toCollectionTrack(row, byTrack.get(row.track_id) ?? []),
      )
    },

    upsertTrack(userId: string, trackId: string, input: TrackWrite): LibraryResult<CollectionTrackDto> {
      if (input.categories) {
        for (const categoryId of input.categories) {
          if (!categoryById.get(userId, categoryId)) {
            return failure(404, 'NOT_FOUND')
          }
        }
      }

      const now = new Date().toISOString()
      const existing = trackById.get(userId, trackId) as TrackRow | undefined
      const liked = input.liked ?? (existing ? existing.liked === 1 : false)
      let likedAt: string | null = null
      if (liked) {
        if (input.likedAtProvided) {
          likedAt = input.likedAt
        } else if (existing?.liked === 1 && existing.liked_at) {
          likedAt = existing.liked_at
        } else {
          likedAt = now
        }
      }

      const values = {
        album: input.albumProvided ? input.album : (existing?.album ?? null),
        genre: input.genreProvided ? input.genre : (existing?.genre ?? null),
        year: input.yearProvided ? input.year : (existing?.year ?? null),
        durationMs: input.durationProvided ? input.durationMs : (existing?.duration_ms ?? null),
        coverUrl: input.coverUrlProvided ? input.coverUrl : (existing?.cover_url ?? null),
        coverColor: input.coverColorProvided ? input.coverColor : (existing?.cover_color ?? null),
        previewUrl: input.previewUrlProvided ? input.previewUrl : (existing?.preview_url ?? null),
        tags: input.tags ?? (existing ? parseJson<string[]>(existing.tags_json, []) : []),
        addedAt: input.addedAt ?? existing?.added_at ?? now,
        lastPlayed: input.lastPlayedProvided ? input.lastPlayed : (existing?.last_played ?? null),
        playCount: input.playCount ?? existing?.play_count ?? 0,
        disliked: input.disliked ?? (existing ? existing.disliked === 1 : false),
        skipped: input.skipped ?? existing?.skipped ?? 0,
        notes: input.notesProvided ? (input.notes ?? '') : (existing?.notes ?? ''),
        favorite: input.favorite ?? (existing ? existing.favorite === 1 : false),
        hidden: input.hidden ?? (existing ? existing.hidden === 1 : false),
        customMetadata:
          input.customMetadata ??
          (existing
            ? parseJson<Record<string, unknown>>(existing.custom_metadata_json, {})
            : {}),
      }

      inTransaction(db, () => {
        upsertTrackStmt.run(
          userId,
          trackId,
          input.sourceId,
          input.externalId,
          input.title,
          input.artist,
          values.album,
          values.genre,
          values.year,
          values.durationMs,
          values.coverUrl,
          values.coverColor,
          values.previewUrl,
          JSON.stringify(values.tags),
          values.addedAt,
          now,
          values.lastPlayed,
          values.playCount,
          flag(liked),
          likedAt,
          flag(values.disliked),
          values.skipped,
          values.notes,
          flag(values.favorite),
          flag(values.hidden),
          JSON.stringify(values.customMetadata),
        )
        if (input.categories) {
          syncCategories(userId, trackId, input.categories, now)
        }
      })

      const track = readTrack(userId, trackId)
      if (!track) {
        return failure(500, 'INTERNAL')
      }
      return { ok: true, value: track }
    },

    deleteTrack(userId: string, trackId: string): LibraryResult<{ ok: true }> {
      const result = deleteTrackStmt.run(userId, trackId)
      if (Number(result.changes) === 0) {
        return failure(404, 'NOT_FOUND')
      }
      return { ok: true, value: { ok: true } }
    },

    listAssignments(userId: string): AssignmentDto[] {
      return (listAssignmentsStmt.all(userId) as AssignmentRow[]).map(toAssignment)
    },

    assign(
      userId: string,
      trackId: string,
      categoryId: string,
      assignmentId: string | null,
    ): LibraryResult<AssignmentDto> {
      if (!categoryById.get(userId, categoryId) || !trackById.get(userId, trackId)) {
        return failure(404, 'NOT_FOUND')
      }
      const existing = assignmentByPair.get(userId, categoryId, trackId) as AssignmentRow | undefined
      if (existing) {
        return { ok: true, value: toAssignment(existing) }
      }
      const id = assignmentId ?? `asg_${randomUUID()}`
      if (assignmentById.get(userId, id)) {
        return failure(409, 'ASSIGNMENT_EXISTS')
      }
      insertAssignment.run(userId, id, categoryId, trackId, new Date().toISOString())
      const created = assignmentByPair.get(userId, categoryId, trackId) as AssignmentRow
      return { ok: true, value: toAssignment(created) }
    },

    unassign(userId: string, trackId: string, categoryId: string): LibraryResult<{ ok: true }> {
      if (!categoryById.get(userId, categoryId) || !trackById.get(userId, trackId)) {
        return failure(404, 'NOT_FOUND')
      }
      deleteAssignmentPair.run(userId, categoryId, trackId)
      return { ok: true, value: { ok: true } }
    },

    listHistory,

    appendHistory(userId: string, input: HistoryWrite): LibraryResult<HistoryEntryDto> {
      const id = input.id ?? `hist_${randomUUID()}`
      if (historyById.get(userId, id)) {
        return failure(409, 'HISTORY_EXISTS')
      }
      if (input.category && !categoryById.get(userId, input.category.id)) {
        return failure(404, 'NOT_FOUND')
      }
      const createdAt = input.createdAt ?? new Date().toISOString()
      insertHistory.run(
        userId,
        id,
        input.track.id,
        input.sourceId,
        input.action,
        input.category?.id ?? null,
        input.category ? JSON.stringify(input.category) : null,
        JSON.stringify(input.track),
        createdAt,
      )
      const row = historyById.get(userId, id) as HistoryRow
      return { ok: true, value: toHistory(row) }
    },

    readSettings,

    updateSettings(userId: string, gestureConfig: GestureConfig): UserSettingsDto {
      upsertSettings.run(userId, JSON.stringify(gestureConfig), new Date().toISOString())
      return readSettings(userId)
    },

    libraryState(userId: string, historyLimit: number): LibraryStateDto {
      return {
        categories: this.listCategories(userId),
        tracks: this.listTracks(userId),
        categoryAssignments: this.listAssignments(userId),
        history: listHistory(userId, historyLimit),
        settings: readSettings(userId),
      }
    },
  }

  function syncCategories(
    userId: string,
    trackId: string,
    categoryIds: string[],
    now: string,
  ): void {
    const current = assignmentsForTrack.all(userId, trackId) as AssignmentRow[]
    const keep = new Set(categoryIds)
    if (categoryIds.length === 0) {
      deleteAllTrackAssignments.run(userId, trackId)
    } else {
      for (const row of current) {
        if (!keep.has(row.category_id)) {
          deleteAssignmentPair.run(userId, row.category_id, trackId)
        }
      }
    }
    const present = new Set(current.map((row) => row.category_id))
    for (const categoryId of categoryIds) {
      if (!present.has(categoryId)) {
        insertAssignment.run(userId, `asg_${randomUUID()}`, categoryId, trackId, now)
      }
    }
  }
}
