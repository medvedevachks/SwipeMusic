import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { loadConfig } from '../../config/env.ts'
import { openDatabase } from '../../db/database.ts'
import { listenAuthServer } from '../../http/server.ts'
import { createForgotPasswordLimiter } from '../../auth/rateLimit.ts'
import { createMemoryMailSender } from '../../mail/memoryMailSender.ts'
import { createPlaybackRepository } from './repository.ts'
import { validatePlaybackBatch } from './validation.ts'

const now = '2026-10-27T12:00:00.000Z'

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-started',
    sessionId: 'session-1',
    eventType: 'playback_started',
    sourceId: 'yandex-music',
    externalId: 'ya-1',
    canonicalTrackId: null,
    positionMs: 0,
    listenedMs: 0,
    durationMs: 180_000,
    reason: null,
    createdAt: now,
    ...overrides,
  }
}

function seedUser(db: ReturnType<typeof openDatabase>, id: string): void {
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)
    VALUES (?, 'Аня', 'Смирнова', ?, 'hash', ?, ?)
  `).run(id, `${id}@localhost.test`, now, now)
}

test('playback stats are idempotent, per user, and do not create canonical tracks', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'user-a')
  seedUser(db, 'user-b')
  const playback = createPlaybackRepository(db)
  const batch = validatePlaybackBatch({
    events: [
      event(),
      event({ eventId: 'evt-progress', eventType: 'playback_progress', positionMs: 15_000, listenedMs: 15_000 }),
      event({ eventId: 'evt-done', eventType: 'playback_completed', positionMs: 180_000, listenedMs: 180_000 }),
    ],
  })
  assert.equal(batch.ok, true)
  if (!batch.ok) {
    return
  }
  const first = playback.insertEvents('user-a', batch.events, now)
  const second = playback.insertEvents('user-a', batch.events, now)
  assert.equal(first.accepted.length, 3)
  assert.equal(second.duplicates.length, 3)
  const stats = playback.statsFor('user-a', 'yandex-music', 'ya-1')
  assert.equal(stats?.playCount, 1)
  assert.equal(stats?.completedCount, 1)
  assert.equal(stats?.skippedCount, 0)
  assert.equal(stats?.listenedMs, 180_000)
  assert.equal(playback.listStats('user-b').length, 0)

  const skipped = validatePlaybackBatch({
    events: [event({
      eventId: 'evt-skip',
      sessionId: 'session-2',
      eventType: 'playback_skipped',
      positionMs: 4_000,
      listenedMs: 4_000,
      reason: 'next',
    })],
  })
  assert.equal(skipped.ok, true)
  if (skipped.ok) {
    playback.insertEvents('user-a', skipped.events, now)
  }
  assert.equal(playback.statsFor('user-a', 'yandex-music', 'ya-1')?.skippedCount, 1)
  assert.equal(playback.statsFor('user-a', 'yandex-music', 'ya-1')?.playCount, 1)

  const canonical = db.prepare('SELECT COUNT(*) AS count FROM user_canonical_tracks').get() as { count: number }
  assert.equal(canonical.count, 0)
  const secret = validatePlaybackBatch({
    events: [event({ externalId: 'https://cdn.example/stream?token=secret' })],
  })
  assert.equal(secret.ok, false)
})

test('progress rows per session are capped', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'user-a')
  const playback = createPlaybackRepository(db)
  const events = Array.from({ length: 9 }, (_, index) => event({
    eventId: `progress-${index}`,
    eventType: 'playback_progress',
    positionMs: (index + 1) * 15_000,
    listenedMs: (index + 1) * 15_000,
  }))
  const parsed = validatePlaybackBatch({ events })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) {
    return
  }
  const result = playback.insertEvents('user-a', parsed.events, now)
  assert.equal(result.accepted.length, 8)
  assert.equal(result.dropped.length, 1)
})

const directory = mkdtempSync(join(tmpdir(), 'swipemusic-playback-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
let server: Server
let baseUrl = ''

async function api(path: string, options: { method?: string; body?: unknown; cookie?: string | null } = {}) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Origin: 'http://127.0.0.1:5173',
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.cookie) {
    headers.Cookie = options.cookie
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const setCookie = response.headers.get('set-cookie')
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
  }
}

test('playback events require the signed-in user and ignore a foreign user id', async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 15 * 60 * 1000),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server address missing')
  }
  baseUrl = `http://127.0.0.1:${address.port}`

  const anonymous = await api('/api/me/playback-events', {
    method: 'POST',
    body: { events: [event({ eventId: 'http-1', sessionId: 'http-session' })] },
  })
  assert.equal(anonymous.status, 401)

  const registered = await api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Аня',
      lastName: 'Смирнова',
      email: 'playback@localhost.test',
      password: 'correct-horse',
    },
  })
  assert.equal(registered.status, 201)
  const saved = await api('/api/me/playback-events', {
    method: 'POST',
    cookie: registered.cookie,
    body: {
      userId: 'someone-else',
      events: [event({ eventId: 'http-1', sessionId: 'http-session' })],
    },
  })
  assert.equal(saved.status, 200)
  const repeated = await api('/api/me/playback-events', {
    method: 'POST',
    cookie: registered.cookie,
    body: { events: [event({ eventId: 'http-1', sessionId: 'http-session' })] },
  })
  assert.equal(repeated.status, 200)
  const repeatedBody = repeated.body as { duplicates?: string[] }
  assert.equal(repeatedBody.duplicates?.length, 1)
  const stats = await api('/api/me/playback-stats', { cookie: registered.cookie })
  const rows = stats.body.stats as Array<{ playCount: number }>
  assert.equal(rows[0]?.playCount, 1)

  const other = await api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Борис',
      lastName: 'Иванов',
      email: 'other-playback@localhost.test',
      password: 'correct-horse',
    },
  })
  const otherStats = await api('/api/me/playback-stats', { cookie: other.cookie })
  assert.deepEqual(otherStats.body.stats, [])
})

after(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
