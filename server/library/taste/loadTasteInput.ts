import type { DatabaseSync } from 'node:sqlite'
import type {
  TasteCatalog,
  TasteHistoryEntry,
  TasteInput,
  TasteLibraryTrack,
  TastePlaybackEvent,
  TastePlaybackStat,
  TasteSourceCopy,
} from '../../../src/services/taste/types.ts'
import { TASTE_LIMITS } from '../../../src/services/taste/weights.ts'

/**
 * Чтение только строк userId из сессии.
 * Идентификатор из тела запроса сюда не подставляется.
 * Жанр коллекции не выбирается: это не признак вкуса.
 */

type LibraryRow = {
  id: string
  title: string
  artist: string
  liked: number
  disliked: number
  hidden: number
  play_count: number
  skipped: number
  last_played: string | null
}

type CopyRow = {
  canonical_track_id: string
  source_id: string
  external_id: string
}

type CatalogLinkRow = {
  catalog_id: string
  canonical_track_id: string
}

type CatalogRow = {
  id: string
  name: string
}

type StatRow = {
  source_id: string
  external_id: string
  canonical_track_id: string | null
  play_count: number
  completed_count: number
  skipped_count: number
  listened_ms: number
}

type EventRow = {
  session_id: string
  event_type: string
  source_id: string
  external_id: string
  canonical_track_id: string | null
  listened_ms: number
  duration_ms: number | null
  reason: string | null
  created_at: string
}

type HistoryRow = {
  source_id: string
  track_id: string
  action: string
  category_id: string | null
  created_at: string
}

export function loadTasteInput(db: DatabaseSync, userId: string): TasteInput {
  const libraryRows = db.prepare(`
    SELECT track.id, track.title, track.artist,
           state.liked, state.disliked, state.hidden, state.play_count, state.skipped, state.last_played
    FROM user_canonical_tracks AS track
    JOIN user_canonical_library_tracks AS state
      ON state.user_id = track.user_id AND state.canonical_track_id = track.id
    WHERE track.user_id = ?
    ORDER BY track.id
  `).all(userId) as LibraryRow[]

  const copies = db.prepare(`
    SELECT canonical_track_id, source_id, external_id
    FROM user_track_source_copies
    WHERE user_id = ?
    ORDER BY canonical_track_id, source_id, external_id
  `).all(userId) as CopyRow[]

  const links = db.prepare(`
    SELECT catalog_id, canonical_track_id
    FROM user_catalog_canonical_tracks
    WHERE user_id = ?
    ORDER BY catalog_id, canonical_track_id
  `).all(userId) as CatalogLinkRow[]

  const catalogs = (db.prepare(`
    SELECT id, name
    FROM user_categories
    WHERE user_id = ?
    ORDER BY id
  `).all(userId) as CatalogRow[]).map((row): TasteCatalog => ({ id: row.id, name: row.name }))

  const stats = (db.prepare(`
    SELECT source_id, external_id, canonical_track_id, play_count, completed_count, skipped_count, listened_ms
    FROM user_playback_stats
    WHERE user_id = ?
    ORDER BY source_id, external_id
  `).all(userId) as StatRow[]).map((row): TastePlaybackStat => ({
    sourceId: row.source_id,
    externalId: row.external_id,
    canonicalTrackId: row.canonical_track_id,
    playCount: row.play_count,
    completedCount: row.completed_count,
    skippedCount: row.skipped_count,
    listenedMs: row.listened_ms,
  }))

  const events = (db.prepare(`
    SELECT session_id, event_type, source_id, external_id, canonical_track_id,
           listened_ms, duration_ms, reason, created_at
    FROM (
      SELECT event_id, session_id, event_type, source_id, external_id, canonical_track_id,
             listened_ms, duration_ms, reason, created_at
      FROM user_playback_events
      WHERE user_id = ?
      ORDER BY created_at DESC, event_id DESC
      LIMIT ?
    )
    ORDER BY created_at ASC, event_id ASC
  `).all(userId, TASTE_LIMITS.maxEvents) as EventRow[]).map((row): TastePlaybackEvent => ({
    sessionId: row.session_id,
    eventType: row.event_type,
    sourceId: row.source_id,
    externalId: row.external_id,
    canonicalTrackId: row.canonical_track_id,
    listenedMs: row.listened_ms,
    durationMs: row.duration_ms,
    reason: row.reason,
    createdAt: row.created_at,
  }))

  const history = (db.prepare(`
    SELECT source_id, track_id, action, category_id, created_at
    FROM user_history
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(userId, TASTE_LIMITS.maxHistory) as HistoryRow[]).flatMap((row): TasteHistoryEntry[] => {
    const externalId = externalIdFromTrack(row.source_id, row.track_id)
    if (!externalId) {
      return []
    }
    return [{
      action: row.action,
      sourceId: row.source_id,
      externalId,
      canonicalTrackId: null,
      catalogId: row.category_id,
      createdAt: row.created_at,
    }]
  })

  const copiesByCanonical = new Map<string, TasteSourceCopy[]>()
  for (const copy of copies) {
    const list = copiesByCanonical.get(copy.canonical_track_id) ?? []
    list.push({
      sourceId: copy.source_id,
      externalId: copy.external_id,
      canonicalTrackId: copy.canonical_track_id,
    })
    copiesByCanonical.set(copy.canonical_track_id, list)
  }
  const catalogsByCanonical = new Map<string, string[]>()
  for (const link of links) {
    const list = catalogsByCanonical.get(link.canonical_track_id) ?? []
    list.push(link.catalog_id)
    catalogsByCanonical.set(link.canonical_track_id, list)
  }

  const library = libraryRows.map((row): TasteLibraryTrack => ({
    canonicalTrackId: row.id,
    title: row.title,
    artist: row.artist,
    liked: row.liked === 1,
    disliked: row.disliked === 1,
    hidden: row.hidden === 1,
    playCount: row.play_count,
    skipped: row.skipped,
    lastPlayed: row.last_played,
    catalogIds: catalogsByCanonical.get(row.id) ?? [],
    copies: copiesByCanonical.get(row.id) ?? [],
  }))

  return { library, catalogs, stats, events, history }
}

function externalIdFromTrack(sourceId: string, trackId: string): string | null {
  const prefix = `${sourceId}:`
  if (!sourceId || !trackId.startsWith(prefix)) {
    return null
  }
  const externalId = trackId.slice(prefix.length)
  return externalId || null
}
