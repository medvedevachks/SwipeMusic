import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createRelaxedAuthGuards } from '../auth/guards.ts'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from './server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'
import { evaluateOrigin, PRODUCTION_APP_ORIGIN } from './originPolicy.ts'

const directory = mkdtempSync(join(tmpdir(), 'swipemusic-origin-'))
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

test('allowed origins are explicit and ignore wildcards', () => {
  assert.equal(
    evaluateOrigin({
      method: 'POST',
      origin: 'http://127.0.0.1:5173',
      secFetchSite: 'same-origin',
      allowedOrigins: config.allowedOrigins,
    }).ok,
    true,
  )
  assert.equal(
    evaluateOrigin({
      method: 'POST',
      origin: 'https://evil.example',
      secFetchSite: undefined,
      allowedOrigins: config.allowedOrigins,
    }).ok,
    false,
  )
  assert.equal(
    evaluateOrigin({
      method: 'POST',
      origin: 'http://127.0.0.1:5173',
      secFetchSite: 'cross-site',
      allowedOrigins: config.allowedOrigins,
    }).ok,
    false,
  )
  assert.equal(
    evaluateOrigin({
      method: 'POST',
      origin: undefined,
      secFetchSite: 'same-origin',
      allowedOrigins: config.allowedOrigins,
    }).ok,
    false,
  )
  assert.equal(
    evaluateOrigin({
      method: 'GET',
      origin: undefined,
      secFetchSite: 'cross-site',
      allowedOrigins: config.allowedOrigins,
    }).ok,
    true,
  )
  assert.ok(config.allowedOrigins.includes(PRODUCTION_APP_ORIGIN))
  assert.ok(config.allowedOrigins.includes('http://localhost:5173'))
  assert.ok(config.allowedOrigins.includes('https://127.0.0.1:5173'))
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'test',
        MAIL_TRANSPORT: 'memory',
        APP_ALLOWED_ORIGINS: '*',
      }),
    /APP_ALLOWED_ORIGINS/,
  )

  const production = loadConfig({
    NODE_ENV: 'production',
    PORT: '8787',
    APP_PUBLIC_URL: 'https://203.0.113.5',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    SMTP_FROM: 'music@example.com',
    PROVIDER_SESSION_KEY: randomBytes(32).toString('base64'),
  })
  assert.ok(production.allowedOrigins.includes(PRODUCTION_APP_ORIGIN))
  assert.ok(production.allowedOrigins.includes('https://203.0.113.5'))
  assert.equal(production.allowedOrigins.includes('http://127.0.0.1:5173'), false)
})

async function post(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

test('state-changing requests enforce origin without trusting host headers', async () => {
  const server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(20, 60_000),
    ...createRelaxedAuthGuards(),
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('origin test server has no port')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const registerBody = {
    firstName: 'Аня',
    lastName: 'Смирнова',
    email: 'origin-ok@example.com',
    password: 'correct-horse',
  }

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  const head = await fetch(`${baseUrl}/api/health`, { method: 'HEAD' })
  assert.notEqual(head.status, 403)

  const created = await post(baseUrl, '/api/auth/register', {
    Origin: 'http://127.0.0.1:5173',
    Host: 'evil.example',
    'X-Forwarded-Host': 'evil.example',
  }, registerBody)
  assert.equal(created.status, 201)

  const foreign = await post(baseUrl, '/api/auth/login', {
    Origin: 'https://evil.example',
  }, { email: 'origin-ok@example.com', password: 'correct-horse' })
  assert.equal(foreign.status, 403)
  assert.equal(foreign.body.error, 'FORBIDDEN_ORIGIN')
  assert.equal(JSON.stringify(foreign.body).includes(PRODUCTION_APP_ORIGIN), false)

  const crossSite = await post(baseUrl, '/api/auth/login', {
    Origin: 'http://127.0.0.1:5173',
    'Sec-Fetch-Site': 'cross-site',
  }, { email: 'origin-ok@example.com', password: 'correct-horse' })
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.body.error, 'FORBIDDEN_ORIGIN')

  const missing = await post(baseUrl, '/api/auth/register', {}, {
    firstName: 'Аня',
    lastName: 'Смирнова',
    email: 'origin-missing@example.com',
    password: 'correct-horse',
  })
  assert.equal(missing.status, 403)
  const row = db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(
    'origin-missing@example.com',
  ) as { count: number }
  assert.equal(row.count, 0)

  const anonymous = await post(baseUrl, '/api/me/categories', {
    Origin: 'https://evil.example',
  }, { id: 'cat', name: 'Ночь' })
  assert.equal(anonymous.status, 403)

  const login = await post(baseUrl, '/api/auth/login', {
    Origin: 'https://localhost:5173',
  }, { email: 'origin-ok@example.com', password: 'correct-horse' })
  assert.equal(login.status, 200)

  const wrongPassword = await post(baseUrl, '/api/auth/login', {
    Origin: 'http://localhost:5173',
  }, { email: 'origin-ok@example.com', password: 'wrong-password' })
  assert.equal(wrongPassword.status, 401)
})

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
