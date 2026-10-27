import type { DatabaseSync } from 'node:sqlite'
import type { PlaybackEventRecord } from './validation.ts'

const MAX_PROGRESS_PER_SESSION = 8
const STARTED = 'playback_started'
const PROGRESS = 'playback_progress'
const COMPLETED = 'playback_completed'
const SKIPPED = 'playback_skipped'

export type PlaybackStatsRow = {
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  playCount: number
  completedCount: number
  skippedCount: number
  listenedMs: number
}

export type PlaybackInsertResult = {
  accepted: string[]
  duplicates: string[]
  dropped: string[]
}

type EventRow = {
  listened_ms: number
}

type CountRow = {
  count: number
}

type StatsSqlRow = {
  source_id: string
  external_id: string
  canonical_track_id: string | null
  play_count: number
  completed_count: number
  skipped_count: number
  listened_ms: number
}

export function createPlaybackRepository(db: DatabaseSync) {
  const insertEvent = db.prepare(`
    INSERT INTO user_playback_events (
      user_id, event_id, session_id, event_type, source_id, external_id,
      canonical_track_id, position_ms, listened_ms, duration_ms, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, event_id) DO NOTHING
  `)
  const findSameType = db.prepare(`
    SELECT event_id FROM user_playback_events
    WHERE user_id = ? AND session_id = ? AND event_type = ?
    LIMIT 1
  `)
  const countProgress = db.prepare(`
    SELECT COUNT(*) AS count FROM user_playback_events
    WHERE user_id = ? AND session_id = ? AND event_type = ?
  `)
  const lastListened = db.prepare(`
    SELECT listened_ms FROM user_playback_events
    WHERE user_id = ? AND session_id = ?
    ORDER BY listened_ms DESC
    LIMIT 1
  `)
  const upsertStats = db.prepare(`
    INSERT INTO user_playback_stats (
      user_id, source_id, external_id, canonical_track_id,
      play_count, completed_count, skipped_count, listened_ms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, source_id, external_id) DO UPDATE SET
      canonical_track_id = COALESCE(user_playback_stats.canonical_track_id, excluded.canonical_track_id),
      play_count = user_playback_stats.play_count + excluded.play_count,
      completed_count = user_playback_stats.completed_count + excluded.completed_count,
      skipped_count = user_playback_stats.skipped_count + excluded.skipped_count,
      listened_ms = user_playback_stats.listened_ms + excluded.listened_ms,
      updated_at = excluded.updated_at
  `)
  const selectStats = db.prepare(`
    SELECT source_id, external_id, canonical_track_id, play_count, completed_count,
           skipped_count, listened_ms
    FROM user_playback_stats
    WHERE user_id = ? AND source_id = ? AND external_id = ?
  `)
  const listStats = db.prepare(`
    SELECT source_id, external_id, canonical_track_id, play_count, completed_count,
           skipped_count, listened_ms
    FROM user_playback_stats
    WHERE user_id = ?
    ORDER BY updated_at DESC, source_id, external_id
  `)

  return {
    insertEvents(userId: string, events: readonly PlaybackEventRecord[], now = new Date().toISOString()): PlaybackInsertResult {
      const accepted: string[] = []
      const duplicates: string[] = []
      const dropped: string[] = []
      db.exec('BEGIN')
      try {
        for (const event of events) {
          const outcome = insertOne(userId, event, now)
          if (outcome === 'accepted') {
            accepted.push(event.eventId)
          } else if (outcome === 'dropped') {
            dropped.push(event.eventId)
          } else {
            duplicates.push(event.eventId)
          }
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return { accepted, duplicates, dropped }
    },

    statsFor(userId: string, sourceId: string, externalId: string): PlaybackStatsRow | null {
      const row = selectStats.get(userId, sourceId, externalId) as StatsSqlRow | undefined
      return row ? mapStats(row) : null
    },

    listStats(userId: string): PlaybackStatsRow[] {
      return (listStats.all(userId) as StatsSqlRow[]).map(mapStats)
    },
  }

  function insertOne(userId: string, event: PlaybackEventRecord, now: string): 'accepted' | 'duplicate' | 'dropped' {
    if (isSingleton(event.eventType) && findSameType.get(userId, event.sessionId, event.eventType)) {
      return 'duplicate'
    }
    if (event.eventType === PROGRESS) {
      const count = countProgress.get(userId, event.sessionId, PROGRESS) as CountRow
      if ((count?.count ?? 0) >= MAX_PROGRESS_PER_SESSION) {
        return 'dropped'
      }
    }
    const previous = lastListened.get(userId, event.sessionId) as EventRow | undefined
    const delta = Math.max(0, event.listenedMs - (previous?.listened_ms ?? 0))
    const result = insertEvent.run(
      userId,
      event.eventId,
      event.sessionId,
      event.eventType,
      event.sourceId,
      event.externalId,
      event.canonicalTrackId,
      event.positionMs,
      event.listenedMs,
      event.durationMs,
      event.reason,
      event.createdAt,
    )
    if (!result.changes) {
      return 'duplicate'
    }
    const playCount = event.eventType === STARTED ? 1 : 0
    const completedCount = event.eventType === COMPLETED ? 1 : 0
    const skippedCount = event.eventType === SKIPPED ? 1 : 0
    if (playCount || completedCount || skippedCount || delta > 0) {
      upsertStats.run(
        userId,
        event.sourceId,
        event.externalId,
        event.canonicalTrackId,
        playCount,
        completedCount,
        skippedCount,
        delta,
        now,
      )
    }
    return 'accepted'
  }
}

function isSingleton(eventType: string): boolean {
  return eventType === STARTED || eventType === COMPLETED || eventType === SKIPPED
}

function mapStats(row: StatsSqlRow): PlaybackStatsRow {
  return {
    sourceId: row.source_id,
    externalId: row.external_id,
    canonicalTrackId: row.canonical_track_id,
    playCount: row.play_count,
    completedCount: row.completed_count,
    skippedCount: row.skipped_count,
    listenedMs: row.listened_ms,
  }
}
