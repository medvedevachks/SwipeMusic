import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { loadConfig } from './config/env.ts'
import { openDatabase } from './db/database.ts'
import { listenAuthServer } from './http/server.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-auth-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
})

let server: Server
let baseUrl = ''

type ApiResult = {
  status: number
  body: Record<string, unknown>
  cookie: string | null
  setCookie: string | null
}

async function api(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
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
  const body = (await response.json()) as Record<string, unknown>
  return { status: response.status, body, cookie, setCookie }
}

before(async () => {
  server = await listenAuthServer({ db, config })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('auth test server has no port')
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

test('register success', async () => {
  const result = await api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: '  Аня ',
      lastName: ' Смирнова ',
      email: 'Anya@Example.com',
      password,
    },
  })

  assert.equal(result.status, 201)
  const user = result.body.user as Record<string, unknown>
  assert.equal(user.firstName, 'Аня')
  assert.equal(user.lastName, 'Смирнова')
  assert.equal(user.email, 'anya@example.com')
  assert.match(String(user.id), /^[0-9a-f-]{36}$/i)
  assert.equal(typeof user.createdAt, 'string')
  assert.equal('passwordHash' in user, false)
  assert.equal(result.body.token, undefined)
  assert.match(result.cookie ?? '', /^sm_session=/)
  assert.match(result.setCookie ?? '', /HttpOnly/i)
  assert.match(result.setCookie ?? '', /SameSite=Lax/i)
  assert.equal(/password/i.test(result.setCookie ?? ''), false)
})

test('duplicate email rejected', async () => {
  const result = await api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Другая',
      lastName: 'Учётка',
      email: 'anya@example.com',
      password,
    },
  })

  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'EMAIL_TAKEN')
})

test('login success', async () => {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'ANYA@example.com', password },
  })

  assert.equal(result.status, 200)
  const user = result.body.user as { email: string }
  assert.equal(user.email, 'anya@example.com')
  assert.match(result.cookie ?? '', /^sm_session=/)
})

test('wrong password rejected', async () => {
  const wrong = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'anya@example.com', password: 'wrong-password' },
  })
  const unknown = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'missing@example.com', password: 'wrong-password' },
  })

  assert.equal(wrong.status, 401)
  assert.equal(unknown.status, 401)
  assert.equal(wrong.body.error, 'INVALID_CREDENTIALS')
  assert.deepEqual(wrong.body, unknown.body)
})

test('me with valid session', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'anya@example.com', password },
  })
  const me = await api('/api/auth/me', { cookie: login.cookie })

  assert.equal(me.status, 200)
  const user = me.body.user as { email: string }
  assert.equal(user.email, 'anya@example.com')
})

test('me without session', async () => {
  const me = await api('/api/auth/me')
  assert.equal(me.status, 401)
  assert.equal(me.body.error, 'UNAUTHENTICATED')
})

test('logout invalidates session', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'anya@example.com', password },
  })
  const logout = await api('/api/auth/logout', {
    method: 'POST',
    cookie: login.cookie,
  })
  const me = await api('/api/auth/me', { cookie: login.cookie })

  assert.equal(logout.status, 200)
  assert.equal(me.status, 401)
})

test('password is not stored plain text', () => {
  const row = db
    .prepare('SELECT password_hash FROM users WHERE email = ?')
    .get('anya@example.com') as { password_hash: string }

  assert.notEqual(row.password_hash, password)
  assert.match(row.password_hash, /^scrypt\$v1\$/)
  assert.equal(row.password_hash.includes(password), false)
})

test('expired session rejected', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'anya@example.com', password },
  })
  const token = login.cookie?.slice('sm_session='.length) ?? ''
  db.prepare(
    `UPDATE sessions SET expires_at = ? WHERE token_hash = ?`,
  ).run('2000-01-01T00:00:00.000Z', sha256(token))

  const me = await api('/api/auth/me', { cookie: login.cookie })
  assert.equal(me.status, 401)
  assert.equal(me.body.error, 'UNAUTHENTICATED')
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
