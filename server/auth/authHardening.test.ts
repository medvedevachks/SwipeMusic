import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createForgotPasswordLimiter } from './rateLimit.ts'
import {
  LOGIN_ACCOUNT_WINDOW_MS,
  createLoginRateLimiter,
  createRegisterRateLimiter,
} from './rateLimit.ts'
import { PasswordBusyError } from './passwordWork.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { resolveClientIp } from '../http/clientIp.ts'
import { listenAuthServer } from '../http/server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'

const directory = mkdtempSync(join(tmpdir(), 'swipemusic-auth-hardening-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
const servers: Server[] = []

type ApiResult = {
  status: number
  body: Record<string, unknown>
  retryAfter: string | null
}

async function startServer(options: {
  loginLimiter: ReturnType<typeof createLoginRateLimiter>
  registerLimiter: ReturnType<typeof createRegisterRateLimiter>
  passwordWork: { run<T>(operation: () => Promise<T>): Promise<T> }
}): Promise<(path: string, init?: { body?: unknown; headers?: Record<string, string> }) => Promise<ApiResult>> {
  const server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 60_000),
    ...options,
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('auth hardening server has no port')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`

  return async (path, init = {}) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Origin: 'http://127.0.0.1:5173',
      ...(init.headers ?? {}),
    }
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json()) as Record<string, unknown>
    return {
      status: response.status,
      body,
      retryAfter: response.headers.get('retry-after'),
    }
  }
}

function countingWork() {
  let calls = 0
  return {
    calls: () => calls,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      calls += 1
      return operation()
    },
  }
}

after(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('client ip trusts only a single header from the loopback proxy', () => {
  assert.equal(
    resolveClientIp('198.51.100.8', {
      'x-forwarded-for': '203.0.113.9',
      'x-swipe-client-ip': '203.0.113.10',
    }),
    '198.51.100.8',
  )
  assert.equal(
    resolveClientIp('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.4',
    }),
    '127.0.0.1',
  )
  assert.equal(
    resolveClientIp('127.0.0.1', {
      'x-swipe-client-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.50',
    }),
    '203.0.113.10',
  )
  assert.equal(
    resolveClientIp('::1', { 'x-swipe-client-ip': '2001:db8::1' }),
    '2001:db8::1',
  )
  assert.equal(
    resolveClientIp('127.0.0.1', { 'x-swipe-client-ip': '203.0.113.1, 198.51.100.2' }),
    '127.0.0.1',
  )
  assert.equal(resolveClientIp('127.0.0.1', { 'x-swipe-client-ip': 'not-an-ip' }), '127.0.0.1')
})

test('login window expiry and memory cap use the injected clock', () => {
  let now = 1_000_000
  const limiter = createLoginRateLimiter({
    now: () => now,
    accountLimit: 5,
    ipLimit: 30,
    accountWindowMs: LOGIN_ACCOUNT_WINDOW_MS,
    ipWindowMs: LOGIN_ACCOUNT_WINDOW_MS,
  })
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.consume('203.0.113.8', 'anya@example.com').allowed, true)
  }
  const blocked = limiter.consume('203.0.113.8', 'Anya@Example.com')
  assert.equal(blocked.allowed, false)
  if (!blocked.allowed) {
    assert.equal(blocked.retryAfterSeconds, 900)
  }
  assert.equal(limiter.consume('203.0.113.9', 'anya@example.com').allowed, true)
  assert.equal(limiter.consume('203.0.113.8', 'other@example.com').allowed, true)
  now += LOGIN_ACCOUNT_WINDOW_MS
  assert.equal(limiter.consume('203.0.113.8', 'anya@example.com').allowed, true)

  let registerNow = 0
  const registerLimiter = createRegisterRateLimiter({
    now: () => registerNow,
    limit: 1,
    windowMs: 60_000,
    maxKeys: 1,
  })
  assert.equal(registerLimiter.consume('203.0.113.1').allowed, true)
  assert.equal(registerLimiter.consume('203.0.113.1').allowed, false)
  assert.equal(registerLimiter.consume('203.0.113.2').allowed, true)
  assert.equal(registerLimiter.consume('203.0.113.1').allowed, true)
})

test('five login attempts are allowed and the next returns 429 before hashing', async () => {
  let now = 5_000_000
  const passwordWork = countingWork()
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({
      now: () => now,
      accountLimit: 5,
      ipLimit: 30,
    }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork,
  })

  for (let index = 0; index < 5; index += 1) {
    const result = await api('/api/auth/login', {
      body: {
        email: index % 2 === 0 ? 'Anya@Example.com' : 'anya@example.com',
        password: 'wrong-password',
      },
    })
    assert.equal(result.status, 401)
    assert.equal(result.body.error, 'INVALID_CREDENTIALS')
  }
  assert.equal(passwordWork.calls(), 5)

  const limited = await api('/api/auth/login', {
    body: { email: 'anya@example.com', password: 'wrong-password' },
  })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.error, 'RATE_LIMITED')
  assert.equal(limited.retryAfter, '900')
  assert.equal(JSON.stringify(limited.body).includes('anya@example.com'), false)
  assert.equal(passwordWork.calls(), 5)

  now += LOGIN_ACCOUNT_WINDOW_MS
  const again = await api('/api/auth/login', {
    body: { email: 'anya@example.com', password: 'wrong-password' },
  })
  assert.equal(again.status, 401)
})

test('separate client ips and accounts do not share a login lock', async () => {
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 5, ipLimit: 3 }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork: countingWork(),
  })

  for (let index = 0; index < 2; index += 1) {
    const result = await api('/api/auth/login', {
      headers: { 'X-Swipe-Client-Ip': '203.0.113.10' },
      body: { email: 'a@example.com', password: 'wrong-password' },
    })
    assert.equal(result.status, 401)
  }
  const firstOtherAccount = await api('/api/auth/login', {
    headers: { 'X-Swipe-Client-Ip': '203.0.113.10' },
    body: { email: 'b@example.com', password: 'wrong-password' },
  })
  assert.equal(firstOtherAccount.status, 401)
  const ipLimited = await api('/api/auth/login', {
    headers: { 'X-Swipe-Client-Ip': '203.0.113.10' },
    body: { email: 'b@example.com', password: 'wrong-password' },
  })
  assert.equal(ipLimited.status, 429)
  const otherIp = await api('/api/auth/login', {
    headers: { 'X-Swipe-Client-Ip': '203.0.113.11' },
    body: { email: 'b@example.com', password: 'wrong-password' },
  })
  assert.equal(otherIp.status, 401)
})

test('spoofed forwarded headers do not bypass the login limit', async () => {
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 5, ipLimit: 30 }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork: countingWork(),
  })

  for (let index = 0; index < 5; index += 1) {
    const result = await api('/api/auth/login', {
      headers: {
        'X-Forwarded-For': `203.0.113.${index + 1}`,
        'X-Real-IP': `198.51.100.${index + 1}`,
      },
      body: { email: 'spoof@example.com', password: 'wrong-password' },
    })
    assert.equal(result.status, 401)
  }
  const limited = await api('/api/auth/login', {
    headers: { 'X-Forwarded-For': '203.0.113.99' },
    body: { email: 'spoof@example.com', password: 'wrong-password' },
  })
  assert.equal(limited.status, 429)
})

test('parallel login requests cannot pass the same limit', async () => {
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 5, ipLimit: 30 }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork: countingWork(),
  })
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      api('/api/auth/login', {
        body: { email: 'parallel@example.com', password: 'wrong-password' },
      }),
    ),
  )
  assert.equal(results.filter((result) => result.status === 401).length, 5)
  assert.equal(results.filter((result) => result.status === 429).length, 3)
})

test('invalid login payloads do not consume the attempt limit', async () => {
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 1, ipLimit: 30 }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork: countingWork(),
  })
  for (let index = 0; index < 3; index += 1) {
    const invalid = await api('/api/auth/login', { body: { email: 'short@example.com' } })
    assert.equal(invalid.status, 400)
  }
  const attempt = await api('/api/auth/login', {
    body: { email: 'short@example.com', password: 'wrong-password' },
  })
  assert.equal(attempt.status, 401)
})

test('registration is limited per ip before the password hash', async () => {
  const passwordWork = countingWork()
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 100, ipLimit: 100 }),
    registerLimiter: createRegisterRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 }),
    passwordWork,
  })

  for (let index = 0; index < 5; index += 1) {
    const result = await api('/api/auth/register', {
      body: {
        firstName: 'Аня',
        lastName: 'Смирнова',
        email: `reg-${index}@example.com`,
        password: 'correct-horse',
      },
    })
    assert.equal(result.status, 201)
  }
  assert.equal(passwordWork.calls(), 5)
  const limited = await api('/api/auth/register', {
    body: {
      firstName: 'Аня',
      lastName: 'Смирнова',
      email: 'reg-blocked@example.com',
      password: 'correct-horse',
    },
  })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.error, 'RATE_LIMITED')
  assert.ok(Number(limited.retryAfter) > 0)
  assert.equal(passwordWork.calls(), 5)
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  assert.equal(count.count, 5)
})

test('password work saturation returns a controlled error', async () => {
  let active = 0
  let entered = (): void => {}
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release = (): void => {}
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const api = await startServer({
    loginLimiter: createLoginRateLimiter({ accountLimit: 100, ipLimit: 100 }),
    registerLimiter: createRegisterRateLimiter({ limit: 100 }),
    passwordWork: {
      async run<T>(operation: () => Promise<T>): Promise<T> {
        if (active >= 1) {
          throw new PasswordBusyError()
        }
        active += 1
        entered()
        try {
          await hold
          return await operation()
        } finally {
          active -= 1
        }
      },
    },
  })

  const first = api('/api/auth/login', {
    body: { email: 'busy@example.com', password: 'wrong-password' },
  })
  await enteredPromise
  const second = await api('/api/auth/login', {
    headers: { 'X-Swipe-Client-Ip': '203.0.113.40' },
    body: { email: 'busy-other@example.com', password: 'wrong-password' },
  })
  assert.equal(second.status, 503)
  assert.equal(second.body.error, 'BUSY')
  assert.equal(second.retryAfter, '1')
  release()
  const finished = await first
  assert.equal(finished.status, 401)
})
