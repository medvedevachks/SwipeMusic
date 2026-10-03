import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { createForgotPasswordLimiter } from '../../auth/rateLimit.ts'
import { loadConfig } from '../../config/env.ts'
import { openDatabase } from '../../db/database.ts'
import { listenAuthServer } from '../../http/server.ts'
import { createMemoryMailSender } from '../../mail/memoryMailSender.ts'
import { CANONICAL_LIBRARY_MIGRATION } from './repository.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-canonical-library-'))
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

type ApiResult = {
  status: number
  body: Record<string, unknown>
  cookie: string | null
}

type LibraryItem = {
  canonicalTrack: { id: string }
  copies: Array<{ sourceTrackKey: string; sourceId: string }>
  state: {
    liked: boolean
    likedAt: string | null
    disliked: boolean
    favorite: boolean
    hidden: boolean
    playCount: number
    addedAt: string
    lastPlayed: string | null
    notes: string
    skipped: number
  }
  catalogIds: string[]
}

async function api(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { Accept: 'application/json' }
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
  const cookie = setCookie ? (setCookie.split(';')[0] ?? null) : null
  const text = await response.text()
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  return { status: response.status, body, cookie }
}

async function register(email: string) {
  return api('/api/auth/register', {
    method: 'POST',
    body: { firstName: 'Аня', lastName: 'Смирнова', email, password },
  })
}

function userId(email: string): string {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }
  return row.id
}

function itemsOf(body: Record<string, unknown>): LibraryItem[] {
  return body.items as LibraryItem[]
}

async function putTrack(
  cookie: string | null,
  sourceId: string,
  externalId: string,
  extra: Record<string, unknown> = {},
) {
  const key = `${sourceId}:${externalId}`
  return api(`/api/me/collection/tracks/${encodeURIComponent(key)}`, {
    method: 'PUT',
    cookie,
    body: {
      sourceId,
      externalId,
      title: 'Город',
      artist: 'Север',
      durationMs: 180_000,
      ...extra,
    },
  })
}

async function putCatalog(cookie: string | null, id: string, name: string) {
  return api('/api/me/categories', {
    method: 'POST',
    cookie,
    body: {
      id,
      name,
      icon: 'car',
      color: '#2563eb',
      description: '',
      favorite: false,
      system: false,
    },
  })
}

async function assignLegacy(cookie: string | null, sourceId: string, externalId: string, catalogId: string) {
  const key = `${sourceId}:${externalId}`
  return api(
    `/api/me/collection/tracks/${encodeURIComponent(key)}/categories/${catalogId}`,
    { method: 'PUT', cookie, body: {} },
  )
}

function countFor(user: string, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(user) as {
    n: number
  }
  return row.n
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(20, 60_000),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('canonical library test server has no port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('old collection track backfills one canonical library item and keeps the source key', async () => {
  const owner = await register('canon-backfill@example.com')
  const saved = await putTrack(owner.cookie, 'yandex-music', '101', {
    liked: true,
    likedAt: '2024-03-01T00:00:00.000Z',
    addedAt: '2024-02-01T00:00:00.000Z',
    playCount: 2,
  })
  assert.equal(saved.status, 200)

  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  assert.equal(library.status, 200)
  const items = itemsOf(library.body)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.copies.length, 1)
  assert.equal(items[0]?.copies[0]?.sourceTrackKey, 'yandex-music:101')
  assert.equal(items[0]?.state.liked, true)
  assert.equal(items[0]?.state.likedAt, '2024-03-01T00:00:00.000Z')
  assert.equal(items[0]?.state.addedAt, '2024-02-01T00:00:00.000Z')
  assert.equal(items[0]?.state.playCount, 2)

  const legacy = await api('/api/me/library-state', { cookie: owner.cookie })
  assert.equal((legacy.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'yandex-music:101')
})

test('old catalog assignment becomes one canonical membership', async () => {
  const owner = await register('canon-catalog@example.com')
  await putCatalog(owner.cookie, 'cat_drive', 'В машину')
  await putTrack(owner.cookie, 'spotify', '55', { liked: false })
  const assigned = await assignLegacy(owner.cookie, 'spotify', '55', 'cat_drive')
  assert.equal(assigned.status, 200)

  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const item = itemsOf(library.body)[0]
  assert.deepEqual(item?.catalogIds, ['cat_drive'])
  assert.equal(item?.copies[0]?.sourceTrackKey, 'spotify:55')
})

test('migration is idempotent and does not duplicate canonical rows', async () => {
  const email = 'canon-idem@example.com'
  const owner = await register(email)
  await putTrack(owner.cookie, 'local-folder', 'abc')
  await api('/api/me/canonical-library', { cookie: owner.cookie })
  await api('/api/me/canonical-library', { cookie: owner.cookie })
  const id = userId(email)
  assert.equal(countFor(id, 'user_canonical_tracks'), 1)
  assert.equal(countFor(id, 'user_track_source_copies'), 1)
  assert.equal(countFor(id, 'user_canonical_library_tracks'), 1)
  assert.equal(countFor(id, 'user_data_migrations'), 1)
})

test('migration marker is written only after a successful migration', async () => {
  const email = 'canon-marker@example.com'
  const owner = await register(email)
  await putCatalog(owner.cookie, 'cat_mark', 'Ночь')
  await putTrack(owner.cookie, 'yandex-music', '77', { liked: true, likedAt: '2024-05-01T00:00:00.000Z' })
  await assignLegacy(owner.cookie, 'yandex-music', '77', 'cat_mark')
  const id = userId(email)
  db.exec(`
    CREATE TRIGGER fail_canonical_migration
    BEFORE INSERT ON user_data_migrations
    WHEN NEW.user_id = '${id}'
    BEGIN
      SELECT RAISE(ABORT, 'marker blocked');
    END;
  `)
  try {
    const failed = await api('/api/me/canonical-library', { cookie: owner.cookie })
    assert.equal(failed.status, 500)
    assert.equal(countFor(id, 'user_data_migrations'), 0)
    assert.equal(countFor(id, 'user_canonical_tracks'), 0)
    assert.equal(countFor(id, 'user_catalog_canonical_tracks'), 0)
    assert.equal(countFor(id, 'user_collection_tracks'), 1)
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_canonical_migration')
  }

  const restored = await api('/api/me/canonical-library', { cookie: owner.cookie })
  assert.equal(restored.status, 200)
  assert.equal(itemsOf(restored.body).length, 1)
  assert.equal(countFor(id, 'user_data_migrations'), 1)
  const marker = db
    .prepare('SELECT migration_key FROM user_data_migrations WHERE user_id = ?')
    .get(id) as { migration_key: string }
  assert.equal(marker.migration_key, CANONICAL_LIBRARY_MIGRATION)
})

test('already linked copies become one canonical library item', async () => {
  const owner = await register('canon-linked@example.com')
  for (const [sourceId, externalId] of [
    ['yandex-music', '1'],
    ['spotify', '2'],
  ] as const) {
    await api('/api/me/tracks/identity', {
      method: 'POST',
      cookie: owner.cookie,
      body: { sourceId, externalId, title: 'Город', artist: 'Север', durationMs: 180_000 },
    })
  }
  const linked = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKeyA: 'yandex-music:1', sourceTrackKeyB: 'spotify:2' },
  })
  const canonicalId = (linked.body.canonicalTrack as { id: string }).id
  await putTrack(owner.cookie, 'yandex-music', '1', { liked: true, likedAt: '2024-01-01T00:00:00.000Z' })
  await putTrack(owner.cookie, 'spotify', '2', { playCount: 4 })

  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const items = itemsOf(library.body)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.canonicalTrack.id, canonicalId)
  assert.deepEqual(
    items[0]?.copies.map((copy) => copy.sourceTrackKey).sort(),
    ['spotify:2', 'yandex-music:1'],
  )
  assert.equal(items[0]?.state.liked, true)
  assert.equal(items[0]?.state.playCount, 4)
})

test('canonical catalog membership is unique for repeated assign', async () => {
  const email = 'canon-unique@example.com'
  const owner = await register(email)
  await putCatalog(owner.cookie, 'cat_once', 'Любимое')
  await putTrack(owner.cookie, 'local-folder', '9')
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const canonicalId = itemsOf(library.body)[0]?.canonicalTrack.id ?? ''
  const first = await api(`/api/me/catalogs/cat_once/tracks/${canonicalId}`, {
    method: 'PUT',
    cookie: owner.cookie,
  })
  const second = await api(`/api/me/catalogs/cat_once/tracks/${canonicalId}`, {
    method: 'PUT',
    cookie: owner.cookie,
  })
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(
    (first.body.membership as { createdAt: string }).createdAt,
    (second.body.membership as { createdAt: string }).createdAt,
  )
  assert.equal(countFor(userId(email), 'user_catalog_canonical_tracks'), 1)
})

test('one canonical keeps several sources and several catalogs', async () => {
  const owner = await register('canon-multi@example.com')
  await putCatalog(owner.cookie, 'cat_car', 'В машину')
  await putCatalog(owner.cookie, 'cat_fav', 'Любимое')
  await putTrack(owner.cookie, 'yandex-music', '101', {
    liked: true,
    likedAt: '2024-06-01T00:00:00.000Z',
  })
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const canonicalId = itemsOf(library.body)[0]?.canonicalTrack.id ?? ''
  for (const [sourceId, externalId] of [
    ['spotify', '202'],
    ['local-folder', '303'],
  ] as const) {
    await api('/api/me/tracks/identity', {
      method: 'POST',
      cookie: owner.cookie,
      body: { sourceId, externalId, title: 'Город', artist: 'Север', durationMs: 180_000 },
    })
    await api('/api/me/tracks/link', {
      method: 'POST',
      cookie: owner.cookie,
      body: { sourceTrackKeyA: 'yandex-music:101', sourceTrackKeyB: `${sourceId}:${externalId}` },
    })
  }
  await api(`/api/me/catalogs/cat_car/tracks/${canonicalId}`, { method: 'PUT', cookie: owner.cookie })
  await api(`/api/me/catalogs/cat_fav/tracks/${canonicalId}`, { method: 'PUT', cookie: owner.cookie })

  const again = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const item = itemsOf(again.body)[0]
  assert.equal(itemsOf(again.body).length, 1)
  assert.equal(item?.canonicalTrack.id, canonicalId)
  assert.equal(item?.state.liked, true)
  assert.deepEqual(item?.catalogIds, ['cat_car', 'cat_fav'])
  assert.deepEqual(
    item?.copies.map((copy) => copy.sourceId).sort(),
    ['local-folder', 'spotify', 'yandex-music'],
  )
})

test('link merges catalog membership, user state, and leaves no orphan canonical', async () => {
  const email = 'canon-merge@example.com'
  const owner = await register(email)
  await putCatalog(owner.cookie, 'cat_a', 'В машину')
  await putCatalog(owner.cookie, 'cat_b', 'Ночное')
  await putTrack(owner.cookie, 'yandex-music', '1', {
    title: 'Город',
    liked: true,
    likedAt: '2024-01-02T00:00:00.000Z',
    addedAt: '2024-02-01T00:00:00.000Z',
    playCount: 1,
    notes: 'утро',
    favorite: false,
    hidden: false,
  })
  await putTrack(owner.cookie, 'spotify', '2', {
    title: 'Город',
    liked: false,
    disliked: true,
    addedAt: '2024-01-01T00:00:00.000Z',
    playCount: 2,
    lastPlayed: '2024-04-01T00:00:00.000Z',
    notes: 'ночь',
    favorite: true,
    hidden: true,
    skipped: 3,
  })
  await assignLegacy(owner.cookie, 'yandex-music', '1', 'cat_a')
  await assignLegacy(owner.cookie, 'spotify', '2', 'cat_b')
  await api('/api/me/canonical-library', { cookie: owner.cookie })

  const linked = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKeyA: 'yandex-music:1', sourceTrackKeyB: 'spotify:2' },
  })
  const canonicalId = (linked.body.canonicalTrack as { id: string }).id
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const items = itemsOf(library.body)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.canonicalTrack.id, canonicalId)
  assert.deepEqual(items[0]?.catalogIds, ['cat_a', 'cat_b'])
  assert.equal(items[0]?.state.liked, true)
  assert.equal(items[0]?.state.disliked, false)
  assert.equal(items[0]?.state.likedAt, '2024-01-02T00:00:00.000Z')
  assert.equal(items[0]?.state.playCount, 3)
  assert.equal(items[0]?.state.skipped, 3)
  assert.equal(items[0]?.state.favorite, true)
  assert.equal(items[0]?.state.hidden, false)
  assert.equal(items[0]?.state.addedAt, '2024-01-01T00:00:00.000Z')
  assert.equal(items[0]?.state.lastPlayed, '2024-04-01T00:00:00.000Z')
  assert.equal(items[0]?.state.notes, 'утро\n---\nночь')

  const id = userId(email)
  const orphans = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM user_canonical_tracks WHERE user_id = ? AND id != ?) +
        (SELECT COUNT(*) FROM user_track_source_copies WHERE user_id = ? AND canonical_track_id != ?) +
        (SELECT COUNT(*) FROM user_canonical_library_tracks WHERE user_id = ? AND canonical_track_id != ?) +
        (SELECT COUNT(*) FROM user_catalog_canonical_tracks WHERE user_id = ? AND canonical_track_id != ?)
        AS n`,
    )
    .get(id, canonicalId, id, canonicalId, id, canonicalId, id, canonicalId) as { n: number }
  assert.equal(orphans.n, 0)
})

test('unlink gives the detached copy a neutral canonical without catalog memberships', async () => {
  const owner = await register('canon-unlink@example.com')
  await putCatalog(owner.cookie, 'cat_keep', 'В машину')
  await putTrack(owner.cookie, 'yandex-music', '1', {
    liked: true,
    likedAt: '2024-01-02T00:00:00.000Z',
  })
  await putTrack(owner.cookie, 'spotify', '2')
  await assignLegacy(owner.cookie, 'yandex-music', '1', 'cat_keep')
  await api('/api/me/canonical-library', { cookie: owner.cookie })
  await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKeyA: 'yandex-music:1', sourceTrackKeyB: 'spotify:2' },
  })
  const detached = await api('/api/me/tracks/unlink', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKey: 'spotify:2' },
  })
  const detachedId = (detached.body.canonicalTrack as { id: string }).id
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const items = itemsOf(library.body)
  const original = items.find((item) => item.copies.some((copy) => copy.sourceTrackKey === 'yandex-music:1'))
  const created = items.find((item) => item.canonicalTrack.id === detachedId)
  assert.equal(original?.state.liked, true)
  assert.deepEqual(original?.catalogIds, ['cat_keep'])
  assert.equal(created?.copies.length, 1)
  assert.equal(created?.state.liked, false)
  assert.equal(created?.state.playCount, 0)
  assert.deepEqual(created?.catalogIds, [])
  assert.notEqual(created?.canonicalTrack.id, original?.canonicalTrack.id)
})

test('canonical state and catalogs survive closing and reopening sqlite', async () => {
  const reopenDir = mkdtempSync(join(tmpdir(), 'swipemusic-canonical-reopen-'))
  const reopenPath = join(reopenDir, 'test.sqlite')
  let reopenDb: DatabaseSync = openDatabase(reopenPath)
  const reopenConfig = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_PATH: reopenPath,
    APP_PUBLIC_URL: 'http://127.0.0.1:5173',
    MAIL_TRANSPORT: 'memory',
  })
  let reopenServer = await listenAuthServer({
    db: reopenDb,
    config: reopenConfig,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(20, 60_000),
  })
  const address = reopenServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('reopen server has no port')
  }
  const previousBase = baseUrl
  baseUrl = `http://127.0.0.1:${address.port}`
  try {
    const owner = await register('canon-reopen@example.com')
    await putCatalog(owner.cookie, 'cat_car', 'В машину')
    await putCatalog(owner.cookie, 'cat_fav', 'Любимое')
    await putTrack(owner.cookie, 'yandex-music', '101', {
      liked: true,
      likedAt: '2024-06-01T00:00:00.000Z',
    })
    const first = await api('/api/me/canonical-library', { cookie: owner.cookie })
    const canonicalId = itemsOf(first.body)[0]?.canonicalTrack.id ?? ''
    for (const [sourceId, externalId] of [
      ['spotify', '202'],
      ['local-folder', '303'],
    ] as const) {
      await api('/api/me/tracks/identity', {
        method: 'POST',
        cookie: owner.cookie,
        body: { sourceId, externalId, title: 'Город', artist: 'Север', durationMs: 180_000 },
      })
      await api('/api/me/tracks/link', {
        method: 'POST',
        cookie: owner.cookie,
        body: { sourceTrackKeyA: 'yandex-music:101', sourceTrackKeyB: `${sourceId}:${externalId}` },
      })
    }
    await api(`/api/me/catalogs/cat_car/tracks/${canonicalId}`, { method: 'PUT', cookie: owner.cookie })
    await api(`/api/me/catalogs/cat_fav/tracks/${canonicalId}`, { method: 'PUT', cookie: owner.cookie })

    await new Promise<void>((resolve, reject) => {
      reopenServer.close((error) => (error ? reject(error) : resolve()))
    })
    reopenDb.close()
    reopenDb = openDatabase(reopenPath)
    reopenServer = await listenAuthServer({
      db: reopenDb,
      config: reopenConfig,
      mail: createMemoryMailSender(),
      limiter: createForgotPasswordLimiter(20, 60_000),
    })
    const nextAddress = reopenServer.address()
    if (!nextAddress || typeof nextAddress === 'string') {
      throw new Error('reopened canonical server has no port')
    }
    baseUrl = `http://127.0.0.1:${nextAddress.port}`
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'canon-reopen@example.com', password },
    })
    const restored = await api('/api/me/canonical-library', { cookie: login.cookie })
    const item = itemsOf(restored.body)[0]
    assert.equal(item?.canonicalTrack.id, canonicalId)
    assert.equal(item?.state.liked, true)
    assert.deepEqual(item?.catalogIds, ['cat_car', 'cat_fav'])
    assert.deepEqual(
      item?.copies.map((copy) => copy.sourceTrackKey).sort(),
      ['local-folder:303', 'spotify:202', 'yandex-music:101'],
    )
  } finally {
    baseUrl = previousBase
    await new Promise<void>((resolve, reject) => {
      if (!reopenServer.listening) {
        resolve()
        return
      }
      reopenServer.close((error) => (error ? reject(error) : resolve()))
    })
    reopenDb.close()
    rmSync(reopenDir, { recursive: true, force: true })
  }
})

test('another user cannot read or change canonical state and catalogs', async () => {
  const owner = await register('canon-owner@example.com')
  const other = await register('canon-other@example.com')
  await putCatalog(owner.cookie, 'cat_owner', 'В машину')
  await putCatalog(other.cookie, 'cat_other', 'Чужой')
  await putTrack(owner.cookie, 'yandex-music', '101', { liked: true, likedAt: '2024-01-01T00:00:00.000Z' })
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const canonicalId = itemsOf(library.body)[0]?.canonicalTrack.id ?? ''

  const hidden = await api('/api/me/canonical-library', { cookie: other.cookie })
  assert.equal(itemsOf(hidden.body).length, 0)
  const patched = await api(`/api/me/canonical-library/${canonicalId}`, {
    method: 'PATCH',
    cookie: other.cookie,
    body: { liked: false },
  })
  assert.equal(patched.status, 404)
  const assigned = await api(`/api/me/catalogs/cat_other/tracks/${canonicalId}`, {
    method: 'PUT',
    cookie: other.cookie,
  })
  assert.equal(assigned.status, 404)
  const linked = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: other.cookie,
    body: { sourceTrackKeyA: 'yandex-music:101', sourceTrackKeyB: 'spotify:2' },
  })
  assert.equal(linked.status, 404)
})

test('deleting a catalog removes canonical membership and keeps the composition', async () => {
  const owner = await register('canon-delete-cat@example.com')
  await putCatalog(owner.cookie, 'cat_drop', 'В машину')
  await putTrack(owner.cookie, 'spotify', '8', { liked: true, likedAt: '2024-01-01T00:00:00.000Z' })
  await assignLegacy(owner.cookie, 'spotify', '8', 'cat_drop')
  const before = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const canonicalId = itemsOf(before.body)[0]?.canonicalTrack.id
  const removed = await api('/api/me/categories/cat_drop', { method: 'DELETE', cookie: owner.cookie })
  assert.equal(removed.status, 200)
  const after = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const item = itemsOf(after.body)[0]
  assert.equal(item?.canonicalTrack.id, canonicalId)
  assert.equal(item?.state.liked, true)
  assert.deepEqual(item?.catalogIds, [])
  assert.equal(item?.copies[0]?.sourceTrackKey, 'spotify:8')
})

test('old library-state and history stay on the source track after canonical migration', async () => {
  const owner = await register('canon-legacy-api@example.com')
  await putCatalog(owner.cookie, 'cat_old', 'Дорога')
  await putTrack(owner.cookie, 'spotify', 'legacy', { liked: true, likedAt: '2024-01-02T00:00:00.000Z' })
  await assignLegacy(owner.cookie, 'spotify', 'legacy', 'cat_old')
  await api('/api/me/history', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      id: 'hist_legacy',
      action: 'categorize',
      createdAt: '2024-04-01T00:00:00.000Z',
      sourceId: 'spotify',
      track: {
        id: 'spotify:legacy',
        sourceId: 'spotify',
        externalId: 'legacy',
        title: 'Город',
        artist: 'Север',
      },
    },
  })
  const state = await api('/api/me/library-state', { cookie: owner.cookie })
  assert.equal(state.status, 200)
  assert.equal((state.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'spotify:legacy')
  assert.equal(
    (state.body.categoryAssignments as Array<{ trackId: string; categoryId: string }>)[0]?.categoryId,
    'cat_old',
  )
  assert.equal(
    (state.body.history as Array<{ id: string; track: { id: string } }>)[0]?.track.id,
    'spotify:legacy',
  )
  assert.ok(state.body.categories)
  assert.ok(state.body.settings)
  const canonical = await api('/api/me/canonical-library', { cookie: owner.cookie })
  assert.equal(itemsOf(canonical.body)[0]?.catalogIds[0], 'cat_old')
})

test('deleting one source snapshot keeps the canonical composition and its other copy', async () => {
  const owner = await register('canon-delete-copy@example.com')
  await putCatalog(owner.cookie, 'cat_stay', 'Любимое')
  await putTrack(owner.cookie, 'yandex-music', '101', {
    liked: true,
    likedAt: '2024-01-01T00:00:00.000Z',
  })
  await putTrack(owner.cookie, 'spotify', '202')
  await assignLegacy(owner.cookie, 'yandex-music', '101', 'cat_stay')
  await api('/api/me/canonical-library', { cookie: owner.cookie })
  await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKeyA: 'yandex-music:101', sourceTrackKeyB: 'spotify:202' },
  })
  const removed = await api(`/api/me/collection/tracks/${encodeURIComponent('yandex-music:101')}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  })
  assert.equal(removed.status, 200)
  const library = await api('/api/me/canonical-library', { cookie: owner.cookie })
  const item = itemsOf(library.body)[0]
  assert.equal(itemsOf(library.body).length, 1)
  assert.equal(item?.state.liked, true)
  assert.deepEqual(item?.catalogIds, ['cat_stay'])
  assert.deepEqual(
    item?.copies.map((copy) => copy.sourceTrackKey).sort(),
    ['spotify:202', 'yandex-music:101'],
  )
  const legacy = await api('/api/me/library-state', { cookie: owner.cookie })
  assert.equal((legacy.body.tracks as Array<{ trackId: string }>).length, 1)
  assert.equal((legacy.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'spotify:202')
})

test('ensure of the same source track returns the same canonical id', async () => {
  const owner = await register('canon-ensure@example.com')
  const body = {
    sourceId: 'local-folder',
    externalId: 'file-1',
    title: 'Город',
    artist: 'Север',
    durationMs: 180_000,
  }
  const first = await api('/api/me/tracks/identity', { method: 'POST', cookie: owner.cookie, body })
  const second = await api('/api/me/tracks/identity', { method: 'POST', cookie: owner.cookie, body })
  assert.equal(first.status, 200)
  assert.equal(
    (first.body.canonicalTrack as { id: string }).id,
    (second.body.canonicalTrack as { id: string }).id,
  )
  assert.equal((second.body.copies as unknown[]).length, 1)
})
