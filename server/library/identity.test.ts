import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from '../http/server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-identity-'))
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

type IdentityBody = {
  canonicalTrack: { id: string; previewUrl?: string }
  copies: Array<{
    sourceTrackKey: string
    canonicalTrackId: string
    sourceId: string
    previewUrl?: string
  }>
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
    body: {
      firstName: 'Аня',
      lastName: 'Смирнова',
      email,
      password,
    },
  })
}

function snapshot(sourceId: string, externalId: string, title = 'Город') {
  return {
    sourceId,
    externalId,
    title,
    artist: 'Север',
    album: 'Поле',
    durationMs: 180_000,
    artworkUrl: 'https://example.com/cover.jpg',
    previewUrl: 'https://example.com/secret-preview.mp3',
  }
}

function asIdentity(body: Record<string, unknown>): IdentityBody {
  return body as unknown as IdentityBody
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 60_000),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('identity test server has no port')
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

test('source track gets one canonical copy and keeps the old key', async () => {
  const owner = await register('identity-owner@example.com')
  const created = await api('/api/me/tracks/identity', {
    method: 'POST',
    cookie: owner.cookie,
    body: snapshot('yandex-music', '101'),
  })
  assert.equal(created.status, 200)
  const identity = asIdentity(created.body)
  assert.match(identity.canonicalTrack.id, /^can_/)
  assert.equal(identity.copies.length, 1)
  assert.equal(identity.copies[0]?.sourceTrackKey, 'yandex-music:101')
  assert.equal(identity.copies[0]?.sourceId, 'yandex-music')
  assert.equal('previewUrl' in identity.canonicalTrack, false)
  assert.equal('previewUrl' in (identity.copies[0] ?? {}), false)
  assert.equal('sourceId' in identity.canonicalTrack, false)

  const again = await api('/api/me/tracks/identity', {
    method: 'POST',
    cookie: owner.cookie,
    body: snapshot('yandex-music', '101', 'Другое имя'),
  })
  const repeated = asIdentity(again.body)
  assert.equal(repeated.canonicalTrack.id, identity.canonicalTrack.id)
  assert.equal(repeated.copies.length, 1)
  assert.equal(repeated.canonicalTrack.id.startsWith('can_'), true)
})

test('link is idempotent, user scoped, and one canonical holds several sources', async () => {
  const owner = await register('identity-link@example.com')
  const other = await register('identity-other@example.com')
  for (const [sourceId, externalId] of [
    ['yandex-music', '101'],
    ['spotify', '202'],
    ['local-folder', '303'],
  ] as const) {
    const saved = await api('/api/me/tracks/identity', {
      method: 'POST',
      cookie: owner.cookie,
      body: snapshot(sourceId, externalId),
    })
    assert.equal(saved.status, 200)
  }

  const first = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      sourceTrackKeyA: 'yandex-music:101',
      sourceTrackKeyB: 'spotify:202',
    },
  })
  assert.equal(first.status, 200)
  const linked = asIdentity(first.body)
  assert.equal(linked.copies.length, 2)
  const canonicalId = linked.canonicalTrack.id

  const second = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      sourceTrackKeyA: 'yandex-music:101',
      sourceTrackKeyB: 'spotify:202',
    },
  })
  assert.equal(asIdentity(second.body).canonicalTrack.id, canonicalId)

  const third = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      sourceTrackKeyA: 'spotify:202',
      sourceTrackKeyB: 'local-folder:303',
    },
  })
  const all = asIdentity(third.body)
  assert.equal(all.canonicalTrack.id, canonicalId)
  assert.deepEqual(
    all.copies.map((copy) => copy.sourceTrackKey).sort(),
    ['local-folder:303', 'spotify:202', 'yandex-music:101'],
  )
  assert.equal(
    all.copies.every((copy) => copy.canonicalTrackId === canonicalId),
    true,
  )

  const foreign = await api('/api/me/tracks/link', {
    method: 'POST',
    cookie: other.cookie,
    body: {
      sourceTrackKeyA: 'yandex-music:101',
      sourceTrackKeyB: 'spotify:202',
    },
  })
  assert.equal(foreign.status, 404)
  const hidden = await api(
    `/api/me/tracks/${encodeURIComponent('yandex-music:101')}/identity`,
    { cookie: other.cookie },
  )
  assert.equal(hidden.status, 404)

  const detached = await api('/api/me/tracks/unlink', {
    method: 'POST',
    cookie: owner.cookie,
    body: { sourceTrackKey: 'local-folder:303' },
  })
  const alone = asIdentity(detached.body)
  assert.equal(alone.copies.length, 1)
  assert.notEqual(alone.canonicalTrack.id, canonicalId)
  const remaining = await api(
    `/api/me/tracks/${encodeURIComponent('yandex-music:101')}/identity`,
    { cookie: owner.cookie },
  )
  const kept = asIdentity(remaining.body)
  assert.equal(kept.canonicalTrack.id, canonicalId)
  assert.deepEqual(
    kept.copies.map((copy) => copy.sourceTrackKey).sort(),
    ['spotify:202', 'yandex-music:101'],
  )
})

test('old collection, catalog and history survive a safe one-copy backfill', async () => {
  const owner = await register('identity-legacy@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      id: 'cat_keep',
      name: 'Дорога',
      icon: 'car',
      color: '#2563eb',
      description: '',
      favorite: false,
      system: false,
    },
  })
  await api('/api/me/collection/tracks/spotify:legacy', {
    method: 'PUT',
    cookie: owner.cookie,
    body: {
      sourceId: 'spotify',
      externalId: 'legacy',
      title: 'Старая',
      artist: 'Север',
      durationMs: 200_000,
    },
  })
  await api('/api/me/collection/tracks/spotify%3Alegacy/categories/cat_keep', {
    method: 'PUT',
    cookie: owner.cookie,
    body: { id: 'asg_keep' },
  })
  await api('/api/me/history', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      id: 'hist_keep',
      action: 'categorize',
      createdAt: '2024-04-01T00:00:00.000Z',
      sourceId: 'spotify',
      track: {
        id: 'spotify:legacy',
        sourceId: 'spotify',
        externalId: 'legacy',
        title: 'Старая',
        artist: 'Север',
      },
    },
  })

  const before = await api('/api/me/library-state', { cookie: owner.cookie })
  assert.equal((before.body.categories as unknown[]).length, 1)
  assert.equal((before.body.categoryAssignments as unknown[]).length, 1)
  assert.equal((before.body.history as unknown[]).length, 1)
  assert.equal((before.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'spotify:legacy')

  const identity = await api(
    `/api/me/tracks/${encodeURIComponent('spotify:legacy')}/identity`,
    { cookie: owner.cookie },
  )
  assert.equal(identity.status, 200)
  const mapped = asIdentity(identity.body)
  assert.equal(mapped.copies.length, 1)
  assert.equal(mapped.copies[0]?.sourceTrackKey, 'spotify:legacy')

  const after = await api('/api/me/library-state', { cookie: owner.cookie })
  assert.equal((after.body.categories as Array<{ id: string }>)[0]?.id, 'cat_keep')
  assert.equal(
    (after.body.categoryAssignments as Array<{ trackId: string; categoryId: string }>)[0]?.trackId,
    'spotify:legacy',
  )
  assert.equal((after.body.history as Array<{ id: string }>)[0]?.id, 'hist_keep')
  assert.equal((after.body.tracks as unknown[]).length, 1)
})

test('logout, login and reopening sqlite keep the same canonical copies', async () => {
  const reopenDir = mkdtempSync(join(tmpdir(), 'swipemusic-identity-reopen-'))
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
    const user = await register('identity-reopen@example.com')
    for (const [sourceId, externalId] of [
      ['yandex-music', '101'],
      ['spotify', '202'],
      ['local-folder', '303'],
    ] as const) {
      await api('/api/me/tracks/identity', {
        method: 'POST',
        cookie: user.cookie,
        body: snapshot(sourceId, externalId),
      })
    }
    const linked = await api('/api/me/tracks/link', {
      method: 'POST',
      cookie: user.cookie,
      body: {
        sourceTrackKeyA: 'yandex-music:101',
        sourceTrackKeyB: 'spotify:202',
      },
    })
    await api('/api/me/tracks/link', {
      method: 'POST',
      cookie: user.cookie,
      body: {
        sourceTrackKeyA: 'yandex-music:101',
        sourceTrackKeyB: 'local-folder:303',
      },
    })
    const canonicalId = asIdentity(linked.body).canonicalTrack.id

    await api('/api/auth/logout', { method: 'POST', cookie: user.cookie })
    const again = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'identity-reopen@example.com', password },
    })
    const afterLogin = await api(
      `/api/me/tracks/${encodeURIComponent('spotify:202')}/identity`,
      { cookie: again.cookie },
    )
    assert.equal(asIdentity(afterLogin.body).canonicalTrack.id, canonicalId)

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
      throw new Error('reopened identity server has no port')
    }
    baseUrl = `http://127.0.0.1:${nextAddress.port}`
    const restoredLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'identity-reopen@example.com', password },
    })
    const restored = await api(
      `/api/me/tracks/${encodeURIComponent('local-folder:303')}/identity`,
      { cookie: restoredLogin.cookie },
    )
    const identity = asIdentity(restored.body)
    assert.equal(restored.status, 200)
    assert.equal(identity.canonicalTrack.id, canonicalId)
    assert.deepEqual(
      identity.copies.map((copy) => copy.sourceTrackKey).sort(),
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
