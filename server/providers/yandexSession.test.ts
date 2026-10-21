import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createRelaxedAuthGuards } from '../auth/guards.ts'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from '../http/server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'
import { readOrCreateDevProviderSessionKey } from './sessionKey.ts'
import { parseProviderSessionKey } from './sessionCrypto.ts'
import type { YandexUpstream } from './yandexSession.ts'

const password = 'correct-horse'
const tokenA = 'ya-secret-token-a'
const tokenB = 'ya-secret-token-b'
const providerKey = randomBytes(32).toString('base64')
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-yandex-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
  PROVIDER_SESSION_KEY: providerKey,
})

const calls: Array<{ url: string; authorization: string | null }> = []
const yandexUpstream: YandexUpstream = async (url, init) => {
  const authorization = new Headers(init.headers).get('authorization')
  calls.push({ url, authorization })
  if (authorization === `OAuth ${tokenA}` || authorization === `OAuth ${tokenB}`) {
    const userA = authorization === `OAuth ${tokenA}`
    return new Response(
      JSON.stringify({
        result: {
          account: { uid: userA ? 11 : 22, displayName: userA ? 'Anya' : 'Boris' },
          plus: { hasPlus: userA },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
}

const limiter = createForgotPasswordLimiter(100, 15 * 60 * 1000)
let server: Server
let baseUrl = ''

type ApiResult = {
  status: number
  body: Record<string, unknown>
  cookie: string | null
  text: string
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
  const text = await response.text()
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie ? (setCookie.split(';')[0] ?? null) : null
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  return { status: response.status, body, cookie, text }
}

async function register(email: string): Promise<{ cookie: string; userId: string }> {
  const result = await api('/api/auth/register', {
    method: 'POST',
    body: { firstName: 'Тест', lastName: 'Пользователь', email, password },
  })
  assert.equal(result.status, 201)
  const user = result.body.user as { id: string }
  assert.ok(result.cookie)
  return { cookie: result.cookie, userId: user.id }
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter,
    ...createRelaxedAuthGuards(),
    yandexUpstream,
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('yandex test server has no port')
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

test('provider endpoints without a swipe session are 401', async () => {
  const status = await api('/api/me/providers/yandex/status')
  const save = await api('/api/me/providers/yandex/session', {
    method: 'PUT',
    body: { accessToken: tokenA },
  })
  const proxy = await api('/api/yandex-music/account/status')
  assert.equal(status.status, 401)
  assert.equal(save.status, 401)
  assert.equal(proxy.status, 401)
  assert.equal(status.text.includes(tokenA), false)
})

test('user A session is encrypted and isolated from user B', async () => {
  const userA = await register('yandex-a@example.com')
  const userB = await register('yandex-b@example.com')
  calls.length = 0

  const saved = await api('/api/me/providers/yandex/session', {
    method: 'PUT',
    cookie: userA.cookie,
    body: {
      accessToken: tokenA,
      refreshToken: 'refresh-a',
      expiresAt: 1_800_000_000_000,
      tokenType: 'bearer',
      userId: userB.userId,
    },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.connected, true)
  assert.equal(saved.body.displayName, 'Anya')
  assert.equal(saved.text.includes(tokenA), false)
  assert.equal(saved.text.includes('refresh-a'), false)
  assert.equal(calls[0]?.authorization, `OAuth ${tokenA}`)

  const row = db
    .prepare(
      `SELECT user_id, encrypted_session
       FROM user_provider_connections
       WHERE user_id = ? AND provider_id = 'yandex-music'`,
    )
    .get(userA.userId) as { user_id: string; encrypted_session: string } | undefined
  assert.equal(row?.user_id, userA.userId)
  assert.equal(row?.encrypted_session.includes(tokenA), false)
  assert.equal(row?.encrypted_session.includes('refresh-a'), false)

  const statusA = await api('/api/me/providers/yandex/status', { cookie: userA.cookie })
  const statusB = await api('/api/me/providers/yandex/status', { cookie: userB.cookie })
  assert.equal(statusA.body.connected, true)
  assert.equal(statusA.body.displayName, 'Anya')
  assert.equal(statusA.text.includes(tokenA), false)
  assert.equal(statusB.body.connected, false)
  assert.equal(statusB.text.includes('Anya'), false)
  assert.equal(statusB.text.includes(tokenA), false)
})

test('backend proxy injects only the current user token', async () => {
  const userB = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'yandex-b@example.com', password },
  })
  const userA = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'yandex-a@example.com', password },
  })
  calls.length = 0
  const denied = await api('/api/yandex-music/search?text=test', { cookie: userB.cookie })
  assert.equal(denied.status, 401)
  assert.equal(denied.body.error, 'YANDEX_AUTH_REQUIRED')
  assert.equal(calls.length, 0)
  assert.equal(denied.text.includes(tokenA), false)

  const proxied = await api('/api/yandex-music/search?text=test', { cookie: userA.cookie })
  assert.equal(proxied.status, 200)
  assert.equal(calls.at(-1)?.url, 'https://api.music.yandex.net/search?text=test')
  assert.equal(calls.at(-1)?.authorization, `OAuth ${tokenA}`)
  assert.equal(proxied.text.includes(tokenA), false)
})

test('disconnect removes only the current user connection', async () => {
  const userB = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'yandex-b@example.com', password },
  })
  await api('/api/me/providers/yandex/session', {
    method: 'PUT',
    cookie: userB.cookie,
    body: { accessToken: tokenB },
  })
  const userA = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'yandex-a@example.com', password },
  })
  const removed = await api('/api/me/providers/yandex/session', {
    method: 'DELETE',
    cookie: userA.cookie,
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.connected, false)
  assert.equal(removed.text.includes(tokenA), false)

  const statusA = await api('/api/me/providers/yandex/status', { cookie: userA.cookie })
  const statusB = await api('/api/me/providers/yandex/status', { cookie: userB.cookie })
  assert.equal(statusA.body.connected, false)
  assert.equal(statusB.body.connected, true)
  assert.equal(statusB.body.displayName, 'Boris')
  assert.equal(statusB.text.includes(tokenB), false)
})

test('deleting a swipe user cascades the provider connection', () => {
  const before = db
    .prepare(`SELECT COUNT(*) AS count FROM user_provider_connections`)
    .get() as { count: number }
  assert.ok(Number(before.count) >= 1)
  db.prepare(`DELETE FROM users`).run()
  const after = db
    .prepare(`SELECT COUNT(*) AS count FROM user_provider_connections`)
    .get() as { count: number }
  assert.equal(Number(after.count), 0)
})

test('corrupted encrypted session does not crash or leak', async () => {
  const user = await register('yandex-corrupt@example.com')
  await api('/api/me/providers/yandex/session', {
    method: 'PUT',
    cookie: user.cookie,
    body: { accessToken: tokenA },
  })
  db.prepare(
    `UPDATE user_provider_connections SET encrypted_session = ? WHERE user_id = ?`,
  ).run('{"v":1,"alg":"A256GCM","iv":"bad","tag":"bad","data":"bad"}', user.userId)

  calls.length = 0
  const status = await api('/api/me/providers/yandex/status', { cookie: user.cookie })
  assert.equal(status.status, 200)
  assert.equal(status.body.connected, false)
  assert.equal(status.text.includes(tokenA), false)

  const proxy = await api('/api/yandex-music/account/status', { cookie: user.cookie })
  assert.equal(proxy.status, 401)
  assert.equal(proxy.body.error, 'YANDEX_AUTH_REQUIRED')
  assert.equal(calls.length, 0)
  assert.equal(proxy.text.includes(tokenA), false)
})

test('invalid provider session keys are rejected', () => {
  assert.throws(() => parseProviderSessionKey('not-a-key'), /PROVIDER_SESSION_KEY/)
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'music@example.com',
      }),
    /PROVIDER_SESSION_KEY/,
  )
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'music@example.com',
        PROVIDER_SESSION_KEY: 'abc',
      }),
    /PROVIDER_SESSION_KEY/,
  )
})

test('development key file is stable and is not a token', () => {
  const keyDirectory = mkdtempSync(join(tmpdir(), 'swipemusic-key-'))
  const keyPath = join(keyDirectory, 'provider-session.key')
  try {
    const first = readOrCreateDevProviderSessionKey(keyPath)
    const second = readOrCreateDevProviderSessionKey(keyPath)
    assert.equal(first.equals(second), true)
    assert.equal(first.length, 32)
    assert.equal(second.toString('utf8').includes(tokenA), false)
  } finally {
    rmSync(keyDirectory, { recursive: true, force: true })
  }
})
