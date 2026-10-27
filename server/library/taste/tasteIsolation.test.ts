import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUserTasteProfile } from '../../../src/services/taste/buildTasteProfile.ts'
import { openDatabase } from '../../db/database.ts'
import { createPlaybackRepository } from '../playback/repository.ts'
import { validatePlaybackBatch } from '../playback/validation.ts'
import { loadTasteInput } from './loadTasteInput.ts'

const now = '2026-10-27T12:00:00.000Z'

function seedUser(db: ReturnType<typeof openDatabase>, id: string): void {
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)
    VALUES (?, 'Аня', 'Смирнова', ?, 'hash', ?, ?)
  `).run(id, `${id}@localhost.test`, now, now)
}

function seedCanonical(
  db: ReturnType<typeof openDatabase>,
  userId: string,
  canonicalId: string,
  externalId: string,
): void {
  db.prepare(`
    INSERT INTO user_canonical_tracks (
      user_id, id, title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, 'Север', 'Поле', NULL, 180000, NULL, ?, ?)
  `).run(userId, canonicalId, now, now)
  db.prepare(`
    INSERT INTO user_canonical_library_tracks (
      user_id, canonical_track_id, added_at, last_played, play_count, liked, liked_at,
      disliked, skipped, notes, favorite, hidden, custom_metadata_json, updated_at
    ) VALUES (?, ?, ?, NULL, 0, 1, ?, 0, 0, '', 0, 0, '{}', ?)
  `).run(userId, canonicalId, now, now, now)
  db.prepare(`
    INSERT INTO user_track_source_copies (
      user_id, source_track_key, canonical_track_id, source_id, external_id,
      title, artist, album, duration_ms, artwork_url, created_at, updated_at
    ) VALUES (?, ?, ?, 'yandex-music', ?, 'Север', 'Поле', NULL, 180000, NULL, ?, ?)
  `).run(userId, `yandex-music:${externalId}`, canonicalId, externalId, now, now)
}

test('taste input is limited to the session user', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'user-a')
  seedUser(db, 'user-b')
  seedCanonical(db, 'user-a', 'canon-a', 'track-a')
  seedCanonical(db, 'user-b', 'canon-b', 'track-b')
  const playback = createPlaybackRepository(db)
  for (const [userId, externalId, canonicalTrackId] of [
    ['user-a', 'track-a', 'canon-a'],
    ['user-b', 'track-b', 'canon-b'],
  ] as const) {
    const batch = validatePlaybackBatch({
      events: [{
        eventId: `started-${userId}`,
        sessionId: `session-${userId}`,
        eventType: 'playback_completed',
        sourceId: 'yandex-music',
        externalId,
        canonicalTrackId,
        positionMs: 180_000,
        listenedMs: 180_000,
        durationMs: 180_000,
        reason: null,
        createdAt: now,
      }],
    })
    assert.equal(batch.ok, true)
    if (batch.ok) {
      playback.insertEvents(userId, batch.events, now)
    }
  }
  db.prepare(`
    INSERT INTO user_history (
      user_id, id, track_id, source_id, action, category_id, category_json, track_json, created_at
    ) VALUES ('user-b', 'hist-b', 'yandex-music:track-b', 'yandex-music', 'like', NULL, NULL, '{}', ?)
  `).run(now)

  const profileA = buildUserTasteProfile('user-a', loadTasteInput(db, 'user-a'), now)
  const profileB = buildUserTasteProfile('user-b', loadTasteInput(db, 'user-b'), now)
  const serializedA = JSON.stringify(profileA)
  assert.equal(serializedA.includes('track-b'), false)
  assert.equal(serializedA.includes('canon-b'), false)
  assert.equal(serializedA.includes('user-b'), false)
  assert.equal(profileA.tracks.some((track) => track.key.kind === 'canonical' && track.key.canonicalTrackId === 'canon-a'), true)
  assert.equal(profileB.tracks.some((track) => track.key.kind === 'canonical' && track.key.canonicalTrackId === 'canon-b'), true)

  const loader = readFileSync('server/library/taste/loadTasteInput.ts', 'utf8')
  assert.equal(loader.includes('genre'), false)
  assert.equal(loader.includes('req.body'), false)
})
