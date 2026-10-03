import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { loadConfig } from './config/env.ts'
import { openDatabase } from './db/database.ts'
import { createForgotPasswordLimiter } from './auth/rateLimit.ts'
import { listenAuthServer } from './http/server.ts'
import { FORGOT_PASSWORD_MESSAGE } from './http/authRoutes.ts'
import { createMemoryMailSender } from './mail/memoryMailSender.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-auth-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
const mailbox = createMemoryMailSender()
const limiter = createForgotPasswordLimiter(3, 15 * 60 * 1000)

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
  server = await listenAuthServer({ db, config, mail: mailbox, limiter })
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

function tokenFromResetUrl(resetUrl: string): string {
  const token = new URL(resetUrl).searchParams.get('token')
  if (!token) {
    throw new Error('reset url has no token')
  }
  return token
}

async function registerUser(email: string, userPassword = password) {
  return api('/api/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Ира',
      lastName: 'Петрова',
      email,
      password: userPassword,
    },
  })
}

test('forgot-password existing email returns generic success', async () => {
  const before = mailbox.messages.length
  await registerUser('known@example.com')
  const result = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'Known@Example.com' },
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.message, FORGOT_PASSWORD_MESSAGE)
  assert.equal(mailbox.messages.length, before + 1)
  assert.equal(mailbox.messages.at(-1)?.to, 'known@example.com')
})

test('forgot-password unknown email returns the same generic success', async () => {
  const before = mailbox.messages.length
  const result = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'missing-reset@example.com' },
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.message, FORGOT_PASSWORD_MESSAGE)
  assert.equal(mailbox.messages.length, before)
})

test('reset token is stored hashed', async () => {
  await registerUser('hashed@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'hashed@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  const row = db
    .prepare('SELECT token_hash FROM password_reset_tokens WHERE token_hash = ?')
    .get(sha256(token)) as { token_hash: string }

  assert.equal(row.token_hash, sha256(token))
  assert.notEqual(row.token_hash, token)
  assert.equal(row.token_hash.includes(token), false)
})

test('valid reset changes password', async () => {
  await registerUser('change@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'change@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  const result = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.passwordHash, undefined)
  assert.equal(result.setCookie, null)
})

test('used reset token rejected', async () => {
  await registerUser('used@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'used@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  const first = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  const second = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'another-password' },
  })

  assert.equal(first.status, 200)
  assert.equal(second.status, 400)
  assert.equal(second.body.error, 'INVALID_RESET_TOKEN')
})

test('expired reset token rejected', async () => {
  await registerUser('expired@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'expired@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  db.prepare(
    'UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?',
  ).run('2000-01-01T00:00:00.000Z', sha256(token))

  const result = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  assert.equal(result.status, 400)
  assert.equal(result.body.error, 'INVALID_RESET_TOKEN')
})

test('invalid reset token rejected', async () => {
  const result = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: 'not-a-real-token', password: 'brand-new-password' },
  })
  assert.equal(result.status, 400)
  assert.equal(result.body.error, 'INVALID_RESET_TOKEN')
})

test('old password rejected after reset', async () => {
  await registerUser('old-pass@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'old-pass@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'old-pass@example.com', password },
  })
  assert.equal(login.status, 401)
  assert.equal(login.body.error, 'INVALID_CREDENTIALS')
})

test('new password accepted after reset', async () => {
  await registerUser('new-pass@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'new-pass@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'new-pass@example.com', password: 'brand-new-password' },
  })
  assert.equal(login.status, 200)
  const user = login.body.user as { email: string }
  assert.equal(user.email, 'new-pass@example.com')
})

test('all existing sessions invalidated after reset', async () => {
  const registered = await registerUser('sessions@example.com')
  const second = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'sessions@example.com', password },
  })
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'sessions@example.com' },
  })
  const token = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  const reset = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'brand-new-password' },
  })
  const firstMe = await api('/api/auth/me', { cookie: registered.cookie })
  const secondMe = await api('/api/auth/me', { cookie: second.cookie })

  assert.equal(reset.status, 200)
  assert.equal(firstMe.status, 401)
  assert.equal(secondMe.status, 401)
})

test('new reset invalidates previous active reset', async () => {
  await registerUser('rotate@example.com')
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'rotate@example.com' },
  })
  const firstToken = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'rotate@example.com' },
  })
  const secondToken = tokenFromResetUrl(mailbox.messages.at(-1)!.resetUrl)
  const stale = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: firstToken, password: 'brand-new-password' },
  })
  const fresh = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: secondToken, password: 'brand-new-password' },
  })

  assert.notEqual(firstToken, secondToken)
  assert.equal(stale.status, 400)
  assert.equal(stale.body.error, 'INVALID_RESET_TOKEN')
  assert.equal(fresh.status, 200)
})

test('rate limit works', async () => {
  const known = 'rate-known@example.com'
  const unknown = 'rate-unknown@example.com'
  await registerUser(known)

  for (let index = 0; index < 3; index += 1) {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: known },
    })
    assert.equal(result.status, 200)
  }
  for (let index = 0; index < 3; index += 1) {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: unknown },
    })
    assert.equal(result.status, 200)
  }

  const knownLimited = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: known },
  })
  const unknownLimited = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: unknown },
  })

  assert.equal(knownLimited.status, 429)
  assert.equal(unknownLimited.status, 429)
  assert.deepEqual(knownLimited.body, unknownLimited.body)
  assert.equal(knownLimited.body.error, 'RATE_LIMITED')
})

test('production rejects console mail transport', () => {
  assert.throws(() =>
    loadConfig({
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'console',
      PORT: '8787',
      APP_PUBLIC_URL: 'https://music.example',
    }),
  )
})

