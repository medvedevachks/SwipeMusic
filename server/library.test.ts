import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createForgotPasswordLimiter } from './auth/rateLimit.ts'
import { loadConfig } from './config/env.ts'
import { openDatabase } from './db/database.ts'
import type { DatabaseSync } from 'node:sqlite'
import { listenAuthServer } from './http/server.ts'
import { createMemoryMailSender } from './mail/memoryMailSender.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-library-'))
const databasePath = join(directory, 'test.sqlite')
let db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
const mailbox = createMemoryMailSender()
const limiter = createForgotPasswordLimiter(100, 15 * 60 * 1000)

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

async function register(email: string, userPassword = password) {
  return api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Аня',
      lastName: 'Смирнова',
      email,
      password: userPassword,
    },
  })
}

function trackPayload(externalId = 'track-1', extra: Record<string, unknown> = {}) {
  return {
    sourceId: 'spotify',
    externalId,
    title: 'Песня',
    artist: 'Исполнитель',
    album: 'Альбом',
    durationMs: 180000,
    coverUrl: 'https://example.com/cover.jpg',
    previewUrl: 'https://example.com/preview.mp3',
    liked: true,
    likedAt: '2024-01-02T00:00:00.000Z',
    notes: 'заметка',
    ...extra,
  }
}

function categoryPayload(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Ночь',
    icon: 'moon',
    color: '#102030',
    description: 'тихо',
    favorite: false,
    system: false,
    ...extra,
  }
}

before(async () => {
  server = await listenAuthServer({ db, config, mail: mailbox, limiter })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('library test server has no port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await closeServer(server)
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('foreign keys are enabled on the sqlite connection', () => {
  const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
  assert.equal(row.foreign_keys, 1)
})

test('library API without session is 401', async () => {
  const paths = [
    '/api/me/library-state',
    '/api/me/categories',
    '/api/me/collection',
    '/api/me/history',
    '/api/me/settings',
  ]
  for (const path of paths) {
    const result = await api(path)
    assert.equal(result.status, 401)
    assert.equal(result.body.error, 'UNAUTHENTICATED')
  }

  const posted = await api('/api/me/categories', {
    method: 'POST',
    body: categoryPayload('cat_guest'),
  })
  assert.equal(posted.status, 401)
  assert.equal(posted.body.user, undefined)
})

test('client cannot choose owner through a user id route or body', async () => {
  const owner = await register('owner-route@example.com')
  const other = await register('other-route@example.com')
  const otherId = (other.body.user as { id: string }).id

  const byUrl = await api(`/api/users/${otherId}/categories`, { cookie: owner.cookie })
  assert.equal(byUrl.status, 404)

  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: categoryPayload('cat_owner_only', { userId: otherId }),
  })
  assert.equal(created.status, 400)

  const ownerList = await api('/api/me/categories', { cookie: owner.cookie })
  const otherList = await api('/api/me/categories', { cookie: other.cookie })
  assert.deepEqual(ownerList.body.categories, [])
  assert.deepEqual(otherList.body.categories, [])
})

test('categories persist, keep client ids, and stay inside the user', async () => {
  const anna = await register('categories-a@example.com')
  const boris = await register('categories-b@example.com')

  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: anna.cookie,
    body: categoryPayload('cat_keep', { name: "Любимое'); DROP TABLE users;--" }),
  })
  assert.equal(created.status, 201)
  const category = created.body.category as { id: string; name: string; createdAt: string }
  assert.equal(category.id, 'cat_keep')
  assert.match(category.createdAt, /Z$/)
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  assert.ok(Number(users.count) > 0)

  const renamed = await api('/api/me/categories/cat_keep', {
    method: 'PATCH',
    cookie: anna.cookie,
    body: { name: 'Вечер' },
  })
  assert.equal(renamed.status, 200)
  assert.equal((renamed.body.category as { name: string }).name, 'Вечер')

  const hidden = await api('/api/me/categories/cat_keep', {
    method: 'PATCH',
    cookie: boris.cookie,
    body: { name: 'Чужое' },
  })
  const hiddenDelete = await api('/api/me/categories/cat_keep', {
    method: 'DELETE',
    cookie: boris.cookie,
  })
  assert.equal(hidden.status, 404)
  assert.equal(hiddenDelete.status, 404)

  const annaList = await api('/api/me/categories', { cookie: anna.cookie })
  const borisList = await api('/api/me/categories', { cookie: boris.cookie })
  const annaCategories = annaList.body.categories as Array<{ id: string; name: string }>
  assert.equal(annaCategories.length, 1)
  assert.equal(annaCategories[0]?.name, 'Вечер')
  assert.deepEqual(borisList.body.categories, [])

  const borisCreated = await api('/api/me/categories', {
    method: 'POST',
    cookie: boris.cookie,
    body: categoryPayload('cat_boris', { name: 'Борис' }),
  })
  assert.equal(borisCreated.status, 201)
  const annaAfter = await api('/api/me/categories', { cookie: anna.cookie })
  assert.equal((annaAfter.body.categories as unknown[]).length, 1)
})

test('system category is not deleted and user category deletion drops assignments only', async () => {
  const user = await register('delete-category@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: user.cookie,
    body: categoryPayload('cat_system', { name: 'Любимое', system: true, icon: 'heart' }),
  })
  await api('/api/me/categories', {
    method: 'POST',
    cookie: user.cookie,
    body: categoryPayload('cat_custom', { name: 'Своя' }),
  })
  await api('/api/me/collection/tracks/spotify:keep', {
    method: 'PUT',
    cookie: user.cookie,
    body: trackPayload('keep'),
  })
  await api('/api/me/collection/tracks/spotify:keep/categories/cat_custom', {
    method: 'PUT',
    cookie: user.cookie,
    body: { id: 'asg_keep' },
  })
  await api('/api/me/history', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      id: 'hist_keep',
      action: 'categorize',
      createdAt: '2024-03-01T00:00:00.000Z',
      track: {
        id: 'spotify:keep',
        sourceId: 'spotify',
        externalId: 'keep',
        title: 'Песня',
        artist: 'Исполнитель',
      },
      category: categoryPayload('cat_custom', { name: 'Своя' }),
    },
  })

  const systemDelete = await api('/api/me/categories/cat_system', {
    method: 'DELETE',
    cookie: user.cookie,
  })
  assert.equal(systemDelete.status, 409)
  assert.equal(systemDelete.body.error, 'SYSTEM_CATEGORY')

  const removed = await api('/api/me/categories/cat_custom', {
    method: 'DELETE',
    cookie: user.cookie,
  })
  assert.equal(removed.status, 200)

  const collection = await api('/api/me/collection', { cookie: user.cookie })
  const tracks = collection.body.tracks as Array<{ trackId: string; categories: string[] }>
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0]?.trackId, 'spotify:keep')
  assert.deepEqual(tracks[0]?.categories, [])

  const state = await api('/api/me/library-state', { cookie: user.cookie })
  assert.equal((state.body.categoryAssignments as unknown[]).length, 0)
  assert.equal((state.body.history as Array<{ id: string }>)[0]?.id, 'hist_keep')
  assert.equal(
    (state.body.categories as Array<{ id: string }>).some((item) => item.id === 'cat_system'),
    true,
  )
})

test('collection track upsert persists snapshot and like without a second like table', async () => {
  const user = await register('collection@example.com')
  const first = await api('/api/me/collection/tracks/spotify:track-1', {
    method: 'PUT',
    cookie: user.cookie,
    body: trackPayload(),
  })
  assert.equal(first.status, 200)
  const track = first.body.track as {
    trackId: string
    liked: boolean
    likedAt: string
    track: { id: string; previewUrl: string }
  }
  assert.equal(track.trackId, 'spotify:track-1')
  assert.equal(track.track.id, 'spotify:track-1')
  assert.equal(track.liked, true)
  assert.equal(track.likedAt, '2024-01-02T00:00:00.000Z')
  assert.equal(track.track.previewUrl, 'https://example.com/preview.mp3')

  const second = await api('/api/me/collection/tracks/spotify:track-1', {
    method: 'PUT',
    cookie: user.cookie,
    body: trackPayload('track-1', { title: 'Новое имя', liked: true }),
  })
  const updated = second.body.track as { likedAt: string; track: { title: string } }
  assert.equal(updated.track.title, 'Новое имя')
  assert.equal(updated.likedAt, '2024-01-02T00:00:00.000Z')

  const rejected = await api('/api/me/collection/tracks/spotify:secret', {
    method: 'PUT',
    cookie: user.cookie,
    body: trackPayload('secret', {
      playbackUrl: 'https://cdn.example/stream',
      customMetadata: { accessToken: 'secret' },
    }),
  })
  assert.equal(rejected.status, 400)
  const rows = db
    .prepare('SELECT track_id FROM user_collection_tracks WHERE track_id = ?')
    .all('spotify:secret') as unknown[]
  assert.equal(rows.length, 0)
})

test('collection is isolated between users', async () => {
  const anna = await register('collection-a@example.com')
  const boris = await register('collection-b@example.com')
  await api('/api/me/collection/tracks/spotify:anna', {
    method: 'PUT',
    cookie: anna.cookie,
    body: trackPayload('anna', { title: 'Анна' }),
  })
  await api('/api/me/collection/tracks/spotify:anna', {
    method: 'PUT',
    cookie: boris.cookie,
    body: trackPayload('anna', { title: 'Подмена' }),
  })

  const annaList = await api('/api/me/collection', { cookie: anna.cookie })
  const borisList = await api('/api/me/collection', { cookie: boris.cookie })
  assert.equal((annaList.body.tracks as Array<{ track: { title: string } }>)[0]?.track.title, 'Анна')
  assert.equal((borisList.body.tracks as Array<{ track: { title: string } }>)[0]?.track.title, 'Подмена')

  const removed = await api('/api/me/collection/tracks/spotify:missing', {
    method: 'DELETE',
    cookie: boris.cookie,
  })
  assert.equal(removed.status, 404)
  const annaStill = await api('/api/me/collection', { cookie: anna.cookie })
  assert.equal((annaStill.body.tracks as unknown[]).length, 1)
})

test('category assignment is idempotent and cannot cross users', async () => {
  const anna = await register('assign-a@example.com')
  const boris = await register('assign-b@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: anna.cookie,
    body: categoryPayload('cat_anna'),
  })
  await api('/api/me/categories', {
    method: 'POST',
    cookie: boris.cookie,
    body: categoryPayload('cat_boris', { name: 'Борис' }),
  })
  await api('/api/me/collection/tracks/spotify:shared-id', {
    method: 'PUT',
    cookie: anna.cookie,
    body: trackPayload('shared-id'),
  })

  const first = await api('/api/me/collection/tracks/spotify:shared-id/categories/cat_anna', {
    method: 'PUT',
    cookie: anna.cookie,
    body: { id: 'asg_stable' },
  })
  const second = await api('/api/me/collection/tracks/spotify:shared-id/categories/cat_anna', {
    method: 'PUT',
    cookie: anna.cookie,
    body: { id: 'asg_other' },
  })
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal((first.body.assignment as { id: string }).id, 'asg_stable')
  assert.equal((second.body.assignment as { id: string }).id, 'asg_stable')

  const cross = await api('/api/me/collection/tracks/spotify:shared-id/categories/cat_anna', {
    method: 'PUT',
    cookie: boris.cookie,
    body: {},
  })
  assert.equal(cross.status, 404)

  const crossCategory = await api(
    '/api/me/collection/tracks/spotify:shared-id/categories/cat_boris',
    {
      method: 'PUT',
      cookie: anna.cookie,
      body: {},
    },
  )
  assert.equal(crossCategory.status, 404)

  const cleared = await api('/api/me/collection/tracks/spotify:shared-id/categories/cat_anna', {
    method: 'DELETE',
    cookie: anna.cookie,
  })
  const again = await api('/api/me/collection/tracks/spotify:shared-id/categories/cat_anna', {
    method: 'DELETE',
    cookie: anna.cookie,
  })
  assert.equal(cleared.status, 200)
  assert.equal(again.status, 200)
  const state = await api('/api/me/library-state', { cookie: anna.cookie })
  assert.deepEqual(state.body.categoryAssignments, [])
})

test('history appends, isolates users, and respects limit', async () => {
  const anna = await register('history-a@example.com')
  const boris = await register('history-b@example.com')
  const times = ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z', '2024-01-03T00:00:00.000Z']
  for (const [index, createdAt] of times.entries()) {
    const result = await api('/api/me/history', {
      method: 'POST',
      cookie: anna.cookie,
      body: {
        id: `hist_${index}`,
        action: index === 0 ? 'like' : 'skip',
        createdAt,
        track: {
          id: 'spotify:hist',
          sourceId: 'spotify',
          externalId: 'hist',
          title: 'История',
          artist: 'Исполнитель',
        },
      },
    })
    assert.equal(result.status, 201)
    assert.equal((result.body.entry as { id: string }).id, `hist_${index}`)
  }

  const duplicate = await api('/api/me/history', {
    method: 'POST',
    cookie: anna.cookie,
    body: {
      id: 'hist_0',
      action: 'like',
      track: {
        id: 'spotify:hist',
        sourceId: 'spotify',
        externalId: 'hist',
        title: 'История',
        artist: 'Исполнитель',
      },
    },
  })
  assert.equal(duplicate.status, 409)

  await api('/api/me/history', {
    method: 'POST',
    cookie: boris.cookie,
    body: {
      id: 'hist_boris',
      action: 'previous',
      track: {
        id: 'spotify:boris',
        sourceId: 'spotify',
        externalId: 'boris',
        title: 'Борис',
        artist: 'Исполнитель',
      },
    },
  })

  const limited = await api('/api/me/history?limit=2', { cookie: anna.cookie })
  const history = limited.body.history as Array<{ id: string }>
  assert.deepEqual(
    history.map((entry) => entry.id),
    ['hist_1', 'hist_2'],
  )
  const borisHistory = await api('/api/me/history', { cookie: boris.cookie })
  assert.deepEqual(
    (borisHistory.body.history as Array<{ id: string }>).map((entry) => entry.id),
    ['hist_boris'],
  )

  const tooLarge = await api('/api/me/history?limit=201', { cookie: anna.cookie })
  assert.equal(tooLarge.status, 400)
})

test('settings store only the gesture map and stay per user', async () => {
  const anna = await register('settings-a@example.com')
  const boris = await register('settings-b@example.com')
  const initial = await api('/api/me/settings', { cookie: anna.cookie })
  assert.deepEqual(initial.body.settings, {
    gestureConfig: {
      right: 'categorize',
      left: 'like',
      up: 'skip',
      down: 'previous',
    },
  })

  const secret = await api('/api/me/settings', {
    method: 'PATCH',
    cookie: anna.cookie,
    body: {
      gestureConfig: { left: 'skip', right: 'like', up: 'previous', down: 'categorize' },
      yandexToken: 'nope',
    },
  })
  assert.equal(secret.status, 400)

  const updated = await api('/api/me/settings', {
    method: 'PATCH',
    cookie: anna.cookie,
    body: {
      gestureConfig: { left: 'skip', right: 'like', up: 'previous', down: 'categorize' },
    },
  })
  assert.equal(updated.status, 200)
  const borisSettings = await api('/api/me/settings', { cookie: boris.cookie })
  assert.equal(
    (borisSettings.body.settings as { gestureConfig: { left: string } }).gestureConfig.left,
    'like',
  )
  const annaSettings = await api('/api/me/settings', { cookie: anna.cookie })
  assert.equal(
    (annaSettings.body.settings as { gestureConfig: { left: string } }).gestureConfig.left,
    'skip',
  )
})

test('library-state is one coherent snapshot without secrets', async () => {
  const user = await register('snapshot@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: user.cookie,
    body: categoryPayload('cat_snap', { name: 'Снимок' }),
  })
  await api('/api/me/collection/tracks/spotify:snap', {
    method: 'PUT',
    cookie: user.cookie,
    body: trackPayload('snap', { categories: ['cat_snap'] }),
  })
  await api('/api/me/history', {
    method: 'POST',
    cookie: user.cookie,
    body: {
      id: 'hist_snap',
      action: 'like',
      track: {
        id: 'spotify:snap',
        sourceId: 'spotify',
        externalId: 'snap',
        title: 'Песня',
        artist: 'Исполнитель',
      },
    },
  })
  await api('/api/me/settings', {
    method: 'PATCH',
    cookie: user.cookie,
    body: {
      gestureConfig: { left: 'like', right: 'categorize', up: 'skip', down: 'previous' },
    },
  })

  const state = await api('/api/me/library-state', { cookie: user.cookie })
  assert.equal(state.status, 200)
  const raw = JSON.stringify(state.body)
  assert.equal(raw.includes('passwordHash'), false)
  assert.equal(raw.includes('scrypt'), false)
  assert.equal(raw.includes('sm_session'), false)
  const body = state.body as {
    categories: Array<{ id: string }>
    tracks: Array<{ trackId: string; liked: boolean; categories: string[] }>
    categoryAssignments: Array<{ categoryId: string; trackId: string }>
    history: Array<{ id: string }>
    settings: { gestureConfig: { left: string } }
  }
  assert.equal(body.categories[0]?.id, 'cat_snap')
  assert.equal(body.tracks[0]?.trackId, 'spotify:snap')
  assert.equal(body.tracks[0]?.liked, true)
  assert.deepEqual(body.tracks[0]?.categories, ['cat_snap'])
  assert.equal(body.categoryAssignments[0]?.categoryId, 'cat_snap')
  assert.equal(body.history[0]?.id, 'hist_snap')
  assert.equal(body.settings.gestureConfig.left, 'like')
  assert.equal('passwordHash' in state.body, false)
})

test('logout and next login keep the library', async () => {
  const registered = await register('logout-keep@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: registered.cookie,
    body: categoryPayload('cat_logout', { name: 'Остаётся' }),
  })
  const logout = await api('/api/auth/logout', { method: 'POST', cookie: registered.cookie })
  const afterLogout = await api('/api/me/categories', { cookie: registered.cookie })
  assert.equal(logout.status, 200)
  assert.equal(afterLogout.status, 401)

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'logout-keep@example.com', password },
  })
  const categories = await api('/api/me/categories', { cookie: login.cookie })
  assert.equal((categories.body.categories as Array<{ id: string }>)[0]?.id, 'cat_logout')
})

test('password reset keeps the library and drops sessions', async () => {
  const registered = await register('reset-keep@example.com')
  await api('/api/me/categories', {
    method: 'POST',
    cookie: registered.cookie,
    body: categoryPayload('cat_reset', { name: 'После сброса' }),
  })
  await api('/api/me/collection/tracks/spotify:reset', {
    method: 'PUT',
    cookie: registered.cookie,
    body: trackPayload('reset'),
  })
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'reset-keep@example.com' },
  })
  const token = new URL(mailbox.messages.at(-1)!.resetUrl).searchParams.get('token')
  const reset = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  const oldSession = await api('/api/me/library-state', { cookie: registered.cookie })
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'reset-keep@example.com', password: 'brand-new-password' },
  })
  const state = await api('/api/me/library-state', { cookie: login.cookie })

  assert.equal(reset.status, 200)
  assert.equal(oldSession.status, 401)
  assert.equal((state.body.categories as Array<{ id: string }>)[0]?.id, 'cat_reset')
  assert.equal((state.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'spotify:reset')
})

test('reopening the sqlite file restores the same library', async () => {
  const reopenDir = mkdtempSync(join(tmpdir(), 'swipemusic-reopen-'))
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
    const user = await register('reopen@example.com')
    await api('/api/me/categories', {
      method: 'POST',
      cookie: user.cookie,
      body: categoryPayload('cat_reopen', { name: 'Диск' }),
    })
    await api('/api/me/collection/tracks/spotify:reopen', {
      method: 'PUT',
      cookie: user.cookie,
      body: trackPayload('reopen', { categories: ['cat_reopen'] }),
    })
    await api('/api/me/history', {
      method: 'POST',
      cookie: user.cookie,
      body: {
        id: 'hist_reopen',
        action: 'skip',
        track: {
          id: 'spotify:reopen',
          sourceId: 'spotify',
          externalId: 'reopen',
          title: 'Песня',
          artist: 'Исполнитель',
        },
      },
    })
    await api('/api/me/settings', {
      method: 'PATCH',
      cookie: user.cookie,
      body: {
        gestureConfig: { left: 'skip', right: 'categorize', up: 'like', down: 'previous' },
      },
    })

    await closeServer(reopenServer)
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
      throw new Error('reopened server has no port')
    }
    baseUrl = `http://127.0.0.1:${nextAddress.port}`

    const state = await api('/api/me/library-state', { cookie: user.cookie })
    assert.equal(state.status, 200)
    assert.equal((state.body.categories as Array<{ id: string; name: string }>)[0]?.name, 'Диск')
    assert.equal((state.body.tracks as Array<{ trackId: string }>)[0]?.trackId, 'spotify:reopen')
    assert.equal(
      (state.body.categoryAssignments as Array<{ categoryId: string }>)[0]?.categoryId,
      'cat_reopen',
    )
    assert.equal((state.body.history as Array<{ id: string }>)[0]?.id, 'hist_reopen')
    assert.equal(
      (state.body.settings as { gestureConfig: { left: string } }).gestureConfig.left,
      'skip',
    )
    const raw = JSON.stringify(state.body)
    assert.equal(raw.includes('password'), false)
  } finally {
    await closeServer(reopenServer)
    reopenDb.close()
    rmSync(reopenDir, { recursive: true, force: true })
    baseUrl = previousBase
  }
})

test('deleting a user cascades library rows', () => {
  const userId = 'user-cascade'
  const now = '2024-01-01T00:00:00.000Z'
  db.prepare(
    `INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)
     VALUES (?, 'A', 'B', 'cascade@example.com', 'scrypt$v1$x', ?, ?)`,
  ).run(userId, now, now)
  db.prepare(
    `INSERT INTO user_categories (
      user_id, id, name, icon, color, description, created_at, updated_at, sort_order, favorite, system
    ) VALUES (?, 'cat_cascade', 'Каскад', 'star', '#abcdef', '', ?, ?, 0, 0, 0)`,
  ).run(userId, now, now)
  db.prepare(
    `INSERT INTO user_settings (user_id, gesture_config_json, updated_at) VALUES (?, '{}', ?)`,
  ).run(userId, now)

  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  const categories = db
    .prepare('SELECT COUNT(*) AS count FROM user_categories WHERE user_id = ?')
    .get(userId) as { count: number }
  const settings = db
    .prepare('SELECT COUNT(*) AS count FROM user_settings WHERE user_id = ?')
    .get(userId) as { count: number }
  assert.equal(categories.count, 0)
  assert.equal(settings.count, 0)
})

test('catalog keeps its id and holds tracks from several sources', async () => {
  const owner = await register('catalog-owner@example.com')
  const other = await register('catalog-other@example.com')
  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: categoryPayload('cat_car', { name: 'В машину', icon: 'car', system: true }),
  })
  const night = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: categoryPayload('cat_night', { name: 'Ночь', icon: 'moon' }),
  })
  assert.equal(created.status, 201)
  assert.equal((created.body.category as { id: string }).id, 'cat_car')
  assert.equal(night.status, 201)

  const sources = [
    ['yandex-music', '1'],
    ['local-folder', '2'],
    ['spotify', '3'],
  ] as const
  for (const [sourceId, externalId] of sources) {
    const trackId = `${sourceId}:${externalId}`
    const saved = await api(`/api/me/collection/tracks/${encodeURIComponent(trackId)}`, {
      method: 'PUT',
      cookie: owner.cookie,
      body: {
        sourceId,
        externalId,
        title: externalId,
        artist: sourceId,
      },
    })
    assert.equal(saved.status, 200)
    const assigned = await api(
      `/api/me/collection/tracks/${encodeURIComponent(trackId)}/categories/cat_car`,
      { method: 'PUT', cookie: owner.cookie, body: { id: `asg_${sourceId}` } },
    )
    assert.equal(assigned.status, 200)
  }
  const second = await api(
    '/api/me/collection/tracks/yandex-music%3A1/categories/cat_night',
    { method: 'PUT', cookie: owner.cookie, body: { id: 'asg_night' } },
  )
  assert.equal(second.status, 200)

  const renamed = await api('/api/me/categories/cat_night', {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { name: 'Ночная', updatedAt: '2024-03-01T00:00:00.000Z' },
  })
  assert.equal(renamed.status, 200)
  assert.equal((renamed.body.category as { id: string; name: string }).id, 'cat_night')
  assert.equal((renamed.body.category as { name: string }).name, 'Ночная')

  const history = await api('/api/me/history', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      id: 'hist_catalog',
      action: 'categorize',
      createdAt: '2024-03-01T00:00:00.000Z',
      sourceId: 'yandex-music',
      track: {
        id: 'yandex-music:1',
        sourceId: 'yandex-music',
        externalId: '1',
        title: '1',
        artist: 'yandex-music',
      },
      category: categoryPayload('cat_car', { name: 'В машину', icon: 'car', system: true }),
    },
  })
  assert.equal(history.status, 201)

  await api('/api/auth/logout', { method: 'POST', cookie: owner.cookie })
  const again = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'catalog-owner@example.com', password },
  })
  const state = await api('/api/me/library-state', { cookie: again.cookie })
  const catalogs = state.body.categories as Array<{ id: string; name: string }>
  const assignments = state.body.categoryAssignments as Array<{
    trackId: string
    categoryId: string
  }>
  assert.equal(state.status, 200)
  assert.deepEqual(
    catalogs.map((item) => item.id).sort(),
    ['cat_car', 'cat_night'],
  )
  assert.equal(catalogs.find((item) => item.id === 'cat_night')?.name, 'Ночная')
  const carTracks = assignments
    .filter((item) => item.categoryId === 'cat_car')
    .map((item) => item.trackId)
    .sort()
  assert.deepEqual(carTracks, ['local-folder:2', 'spotify:3', 'yandex-music:1'])
  const yandexCatalogs = assignments
    .filter((item) => item.trackId === 'yandex-music:1')
    .map((item) => item.categoryId)
    .sort()
  assert.deepEqual(yandexCatalogs, ['cat_car', 'cat_night'])
  const historyRow = (state.body.history as Array<{ category?: { id: string } }>)[0]
  assert.equal(historyRow?.category?.id, 'cat_car')

  const foreign = await api('/api/me/library-state', { cookie: other.cookie })
  assert.deepEqual(foreign.body.categories, [])
  const stolen = await api('/api/me/categories/cat_car', {
    method: 'PATCH',
    cookie: other.cookie,
    body: { name: 'Чужой' },
  })
  assert.equal(stolen.status, 404)

  const removed = await api('/api/me/categories/cat_night', {
    method: 'DELETE',
    cookie: again.cookie,
  })
  assert.equal(removed.status, 200)
  const afterDelete = await api('/api/me/library-state', { cookie: again.cookie })
  const left = afterDelete.body.categories as Array<{ id: string }>
  assert.deepEqual(left.map((item) => item.id), ['cat_car'])
  const stillCar = (afterDelete.body.categoryAssignments as Array<{ categoryId: string }>).every(
    (item) => item.categoryId === 'cat_car',
  )
  assert.equal(stillCar, true)
})

function closeServer(target: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!target.listening) {
      resolve()
      return
    }
    target.close((error) => (error ? reject(error) : resolve()))
  })
}
