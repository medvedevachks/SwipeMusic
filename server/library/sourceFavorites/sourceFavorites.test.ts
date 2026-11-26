/**
 * FAV-01 — зеркало внешнего избранного без state.liked / sys_swipes.
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
  const seenAt = '2026-11-26T10:00:00.000Z'
  const sync = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('1', 'One'), snapshot('2', 'Two'), snapshot('3', 'Three')],
      seenAt,
      finalize: true,
    },
  })
  assert.equal(sync.status, 200)
  assert.equal(sync.body.upserted, 3)
  assert.equal(sync.body.pruned, 0)

  const library = await api('/api/me/canonical-library', { cookie: user.cookie })
  assert.equal(library.status, 200)
  const items = library.body.items as Array<{
    canonicalTrack: { title: string }
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

test('resync without duplicates preserves local liked and catalogs', async () => {
  const user = await register('fav-preserve@example.com')
  const first = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('10', 'Keep')],
      seenAt: '2026-11-26T11:00:00.000Z',
      finalize: true,
    },
  })
  assert.equal(first.status, 200)

  const libraryBefore = await api('/api/me/canonical-library', { cookie: user.cookie })
  const item = (libraryBefore.body.items as Array<{
    canonicalTrack: { id: string }
  }>)[0]!
  const liked = await api(`/api/me/canonical-library/${item.canonicalTrack.id}`, {
    method: 'PATCH',
    cookie: user.cookie,
    body: { liked: true },
  })
  assert.equal(liked.status, 200)

  const categories = await api('/api/me/categories', {
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
  assert.ok(categories.status === 200 || categories.status === 201)
  const assigned = await api(
    `/api/me/catalogs/cat_fav_test/tracks/${item.canonicalTrack.id}`,
    { method: 'PUT', cookie: user.cookie },
  )
  assert.equal(assigned.status, 200)

  const second = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('10', 'Keep')],
      seenAt: '2026-11-26T12:00:00.000Z',
      finalize: true,
    },
  })
  assert.equal(second.status, 200)
  assert.equal(second.body.upserted, 1)

  const libraryAfter = await api('/api/me/canonical-library', { cookie: user.cookie })
  const rows = libraryAfter.body.items as Array<{
    canonicalTrack: { id: string; title: string }
    state: { liked: boolean }
    catalogIds: string[]
    sourceFavoriteSourceIds: string[]
  }>
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.state.liked, true)
  assert.ok(rows[0]?.catalogIds.includes('cat_fav_test'))
  assert.deepEqual(rows[0]?.sourceFavoriteSourceIds, ['yandex-music'])
})

test('failed finalize leaves previous imports; successful prune removes missing', async () => {
  const user = await register('fav-prune@example.com')
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('a'), snapshot('b')],
      seenAt: '2026-11-26T13:00:00.000Z',
      finalize: true,
    },
  })

  // Чанк без finalize — prune не выполняется.
  await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('a')],
      seenAt: '2026-11-26T14:00:00.000Z',
      finalize: false,
    },
  })
  let library = await api('/api/me/canonical-library', { cookie: user.cookie })
  let items = library.body.items as Array<{
    sourceFavoriteSourceIds: string[]
    copies: Array<{ externalId: string }>
  }>
  assert.equal(
    items.filter((row) => row.sourceFavoriteSourceIds.includes('yandex-music')).length,
    2,
  )

  const finalized = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [snapshot('a')],
      seenAt: '2026-11-26T14:00:00.000Z',
      finalize: true,
    },
  })
  assert.equal(finalized.status, 200)
  assert.equal(finalized.body.pruned, 1)

  library = await api('/api/me/canonical-library', { cookie: user.cookie })
  items = library.body.items as typeof items
  const mirrored = items.filter((row) =>
    row.sourceFavoriteSourceIds.includes('yandex-music'),
  )
  assert.equal(mirrored.length, 1)
  assert.equal(mirrored[0]?.copies[0]?.externalId, 'a')
})

test('sync rejects mixed sourceId in batch', async () => {
  const user = await register('fav-mixed@example.com')
  const result = await api('/api/me/sources/yandex-music/favorites/sync', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      snapshots: [
        snapshot('1'),
        {
          ...snapshot('2'),
          sourceId: 'spotify',
        },
      ],
      seenAt: '2026-11-26T15:00:00.000Z',
      finalize: true,
    },
  })
  assert.equal(result.status, 400)
})
