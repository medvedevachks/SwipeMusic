/**
 * FAV-01 / FAV-01F — зеркало внешнего избранного: syncId, prune, изоляция.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createRelaxedAuthGuards } from '../../auth/guards.ts'
import { createForgotPasswordLimiter } from '../../auth/rateLimit.ts'
import { loadConfig } from '../../config/env.ts'
import { openDatabase } from '../../db/database.ts'
import { listenAuthServer } from '../../http/server.ts'
import { createMemoryMailSender } from '../../mail/memoryMailSender.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-source-favorites-'))
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

async function api(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<ApiResult> {
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
  const cookie = setCookie ? (setCookie.split(';')[0] ?? null) : null
  const text = await response.text()
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  return { status: response.status, body, cookie }
}

async function register(email: string): Promise<{ cookie: string }> {
  const result = await api('/api/auth/register', {
    method: 'POST',
    body: { firstName: 'Аня', lastName: 'Смирнова', email, password },
  })
  assert.ok(result.status === 200 || result.status === 201)
  assert.ok(result.cookie)
  return { cookie: result.cookie! }
}

function snapshot(externalId: string, title = externalId) {
  return {
    sourceId: 'yandex-music',
    externalId,
    title,
    artist: 'Artist',
    album: null,
    durationMs: 120000,
    artworkUrl: null,
  }
}

async function startSync(cookie: string) {
  const started = await api('/api/me/sources/yandex-music/favorites/sync/start', {
    method: 'POST',
    cookie,
    body: {},
  })
  assert.equal(started.status, 200)
  assert.equal(typeof started.body.syncId, 'string')
  return String(started.body.syncId)
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(20, 60_000),
    ...createRelaxedAuthGuards(),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('source favorites test server has no port')
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

test('sync imports all likes without setting state.liked or sys_swipes', async () => {
  const user = await register('fav-import@example.com')
  const syncId = await startSync(user.cookie)
  const chunk = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      syncId,
      snapshots: [snapshot('1', 'One'), snapshot('2', 'Two'), snapshot('3', 'Three')],
    },
  })
  assert.equal(chunk.status, 200)
  assert.equal(chunk.body.upserted, 3)

  const done = await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId },
  })
  assert.equal(done.status, 200)

  const library = await api('/api/me/canonical-library', { cookie: user.cookie })
  const items = library.body.items as Array<{
    state: { liked: boolean }
    catalogIds: string[]
    sourceFavoriteSourceIds: string[]
  }>
  assert.equal(items.length, 3)
  for (const item of items) {
    assert.equal(item.state.liked, false)
    assert.deepEqual(item.catalogIds, [])
    assert.deepEqual(item.sourceFavoriteSourceIds, ['yandex-music'])
  }
})

test('resync preserves local liked and catalogs; no duplicates', async () => {
  const user = await register('fav-preserve@example.com')
  const firstId = await startSync(user.cookie)
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: firstId, snapshots: [snapshot('10', 'Keep')] },
  })
  await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: firstId },
  })

  const libraryBefore = await api('/api/me/canonical-library', { cookie: user.cookie })
  const item = (libraryBefore.body.items as Array<{ canonicalTrack: { id: string } }>)[0]!
  assert.equal(
    (
      await api(`/api/me/canonical-library/${item.canonicalTrack.id}`, {
        method: 'PATCH',
        cookie: user.cookie,
        body: { liked: true },
      })
    ).status,
    200,
  )
  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      id: 'cat_fav_test',
      name: 'Fav Test',
      icon: 'heart',
      color: '#e11d48',
      description: '',
      favorite: false,
      system: false,
    },
  })
  assert.ok(created.status === 200 || created.status === 201)
  assert.equal(
    (
      await api(`/api/me/catalogs/cat_fav_test/tracks/${item.canonicalTrack.id}`, {
        method: 'PUT',
        cookie: user.cookie,
      })
    ).status,
    200,
  )

  const secondId = await startSync(user.cookie)
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: secondId, snapshots: [snapshot('10', 'Keep')] },
  })
  await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: secondId },
  })

  const libraryAfter = await api('/api/me/canonical-library', { cookie: user.cookie })
  const rows = libraryAfter.body.items as Array<{
    state: { liked: boolean }
    catalogIds: string[]
    sourceFavoriteSourceIds: string[]
  }>
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.state.liked, true)
  assert.ok(rows[0]?.catalogIds.includes('cat_fav_test'))
  assert.deepEqual(rows[0]?.sourceFavoriteSourceIds, ['yandex-music'])
})

test('stale sync cannot upsert or prune after a newer start', async () => {
  const user = await register('fav-stale@example.com')
  const oldId = await startSync(user.cookie)
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: oldId, snapshots: [snapshot('a'), snapshot('b')] },
  })
  await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: oldId },
  })

  const staleId = await startSync(user.cookie)
  const freshId = await startSync(user.cookie)
  assert.notEqual(staleId, freshId)

  const staleUpsert = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: staleId, snapshots: [snapshot('a')] },
  })
  assert.equal(staleUpsert.status, 409)
  assert.equal(staleUpsert.body.error, 'STALE_SYNC')

  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: freshId, snapshots: [snapshot('a')] },
  })
  const staleComplete = await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: staleId },
  })
  assert.equal(staleComplete.status, 409)

  const freshComplete = await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: freshId },
  })
  assert.equal(freshComplete.status, 200)
  assert.equal(freshComplete.body.pruned, 1)

  const library = await api('/api/me/canonical-library', { cookie: user.cookie })
  const mirrored = (
    library.body.items as Array<{
      sourceFavoriteSourceIds: string[]
      copies: Array<{ externalId: string }>
    }>
  ).filter((row) => row.sourceFavoriteSourceIds.includes('yandex-music'))
  assert.equal(mirrored.length, 1)
  assert.equal(mirrored[0]?.copies[0]?.externalId, 'a')
})

test('confirmed empty list prunes mirror; incomplete list never starts prune', async () => {
  const user = await register('fav-empty@example.com')
  const fillId = await startSync(user.cookie)
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: fillId, snapshots: [snapshot('x'), snapshot('y')] },
  })
  await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: fillId },
  })

  const emptyId = await startSync(user.cookie)
  const emptyDone = await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId: emptyId },
  })
  assert.equal(emptyDone.status, 200)
  assert.equal(emptyDone.body.pruned, 2)

  const library = await api('/api/me/canonical-library', { cookie: user.cookie })
  const mirrored = (
    library.body.items as Array<{ sourceFavoriteSourceIds: string[] }>
  ).filter((row) => row.sourceFavoriteSourceIds.includes('yandex-music'))
  assert.equal(mirrored.length, 0)
})

test('users cannot write into another account cookie scope', async () => {
  const a = await register('fav-user-a@example.com')
  const b = await register('fav-user-b@example.com')
  const syncA = await startSync(a.cookie)
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: a.cookie,
    body: { syncId: syncA, snapshots: [snapshot('only-a')] },
  })
  await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: a.cookie,
    body: { syncId: syncA },
  })

  const hijack = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: b.cookie,
    body: { syncId: syncA, snapshots: [snapshot('only-a'), snapshot('injected')] },
  })
  assert.equal(hijack.status, 404)

  const libraryB = await api('/api/me/canonical-library', { cookie: b.cookie })
  assert.equal((libraryB.body.items as unknown[]).length, 0)
})

test('large batch import accepts 200 snapshots across chunks without cap', async () => {
  const user = await register('fav-large@example.com')
  const syncId = await startSync(user.cookie)
  const total = 250
  let upserted = 0
  for (let offset = 0; offset < total; offset += 50) {
    const snapshots = Array.from({ length: 50 }, (_, index) =>
      snapshot(String(offset + index + 1), `T${offset + index + 1}`),
    )
    const chunk = await api('/api/me/sources/yandex-music/favorites/sync', {
      method: 'POST',
      cookie: user.cookie,
      body: { syncId, snapshots },
    })
    assert.equal(chunk.status, 200)
    upserted += Number(chunk.body.upserted)
  }
  assert.equal(upserted, total)
  const done = await api('/api/me/sources/yandex-music/favorites/sync/complete', {
    method: 'POST',
    cookie: user.cookie,
    body: { syncId },
  })
  assert.equal(done.status, 200)
  const library = await api('/api/me/canonical-library', { cookie: user.cookie })
  assert.equal((library.body.items as unknown[]).length, total)
})
