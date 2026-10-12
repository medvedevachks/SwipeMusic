import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from './server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'
import type { YandexUpstream } from '../providers/yandexSession.ts'

const password = 'correct-horse'
const secret = 'super-secret-value'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-deploy-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})

type Call = {
  url: string
  body: string
  headers: Record<string, string>
}

const calls: Call[] = []

function headerMap(init: RequestInit | undefined): Record<string, string> {
  const headers = new Headers(init?.headers)
  const mapped: Record<string, string> = {}
  headers.forEach((value, key) => {
    mapped[key.toLowerCase()] = value
  })
  return mapped
}

const yandexOauthUpstream: YandexUpstream = async (url, init) => {
  const body = typeof init?.body === 'string' ? init.body : new TextDecoder().decode(init?.body as Uint8Array)
  calls.push({ url, body, headers: headerMap(init) })
  if (body.includes(secret)) {
    return new Response(JSON.stringify({ error: 'invalid_client' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (url.endsWith('/token')) {
    return new Response(JSON.stringify({ access_token: 'upstream-token', token_type: 'bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(
    JSON.stringify({
      device_code: 'device',
      user_code: 'ABCD1234',
      verification_url: 'https://oauth.yandex.ru/device',
      interval: 5,
      expires_in: 300,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const yandexMetadataUpstream: YandexUpstream = async (url, init) => {
  calls.push({ url, body: '', headers: headerMap(init) })
  if (url.includes('/redirect')) {
    return new Response('', {
      status: 302,
      headers: { location: 'https://10.0.0.9/secret' },
    })
  }
  return new Response('<download-info><host>s3.mds.yandex.net</host></download-info>', {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  })
}

let server: Server
let baseUrl = ''

async function request(
  path: string,
  options: {
    method?: string
    body?: string
    cookie?: string | null
    headers?: Record<string, string>
  } = {},
): Promise<{ status: number; text: string; headers: Headers }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.cookie) {
    headers.Cookie = options.cookie
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  })
  return { status: response.status, text: await response.text(), headers: response.headers }
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 15 * 60 * 1000),
    yandexOauthUpstream,
    yandexMetadataUpstream,
    resolveMetadataHost: async () => ['77.88.8.8'],
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('deploy test server has no port')
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

async function sessionCookie(): Promise<string> {
  const result = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Тест',
      lastName: 'Деплой',
      email: `deploy-${Date.now()}@example.com`,
      password,
    }),
  })
  assert.equal(result.status, 201)
  const cookie = result.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}

test('GET /api/health returns only ok', async () => {
  const result = await request('/api/health')
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.text), { ok: true })
})

test('yandex oauth without a swipe session is 401', async () => {
  const result = await request('/api/yandex-oauth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=abc',
  })
  assert.equal(result.status, 401)
  assert.equal(result.text.includes('abc'), false)
})

test('device code proxy preserves the form body', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const result = await request('/api/yandex-oauth/device/code', {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=music&device_id=phone',
  })
  assert.equal(result.status, 200)
  assert.equal(calls[0]?.url, 'https://oauth.yandex.ru/device/code')
  assert.equal(calls[0]?.body, 'client_id=music&device_id=phone')
  assert.match(result.text, /ABCD1234/)
  assert.equal(calls[0]?.headers.cookie, undefined)
  assert.equal(calls[0]?.headers.authorization, undefined)
})

test('token poll proxy reaches only the token endpoint', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const result = await request('/api/yandex-oauth/token', {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=device_code&code=device',
  })
  assert.equal(result.status, 200)
  assert.equal(calls[0]?.url, 'https://oauth.yandex.ru/token')
  assert.equal(calls[0]?.body, 'grant_type=device_code&code=device')
  assert.match(result.text, /upstream-token/)
})

test('unsupported yandex oauth path is rejected', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const result = await request('/api/yandex-oauth/revoke', { method: 'POST', cookie, body: 'x=1' })
  assert.equal(result.status, 404)
  assert.equal(calls.length, 0)
})

test('unsupported yandex oauth method is rejected', async () => {
  const result = await request('/api/yandex-oauth/device/code')
  assert.equal(result.status, 405)
  assert.match(result.headers.get('allow') ?? '', /POST/)
})

test('oauth upstream failure does not echo request secrets', async () => {
  const cookie = await sessionCookie()
  const logged: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    logged.push(args.map((item) => String(item)).join(' '))
  }
  try {
    calls.length = 0
    const result = await request('/api/yandex-oauth/token', {
      method: 'POST',
      cookie,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=device_code&client_secret=${secret}`,
    })
    assert.equal(result.status, 400)
    assert.equal(result.text.includes(secret), false)
    assert.equal(logged.join('\n').includes(secret), false)
    assert.equal(calls[0]?.headers.cookie, undefined)
    assert.equal(calls[0]?.headers.authorization, undefined)
  } finally {
    console.error = original
  }
})

test('yandex fetch without a swipe session is 401', async () => {
  const result = await request(
    '/api/yandex-fetch?url=' + encodeURIComponent('https://storage.mds.yandex.net/file-download-info/1'),
  )
  assert.equal(result.status, 401)
})

test('yandex fetch rejects non-https, foreign, localhost, and private targets', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const targets = [
    'http://storage.mds.yandex.net/file-download-info/1',
    'https://example.com/file',
    'https://localhost/file',
    'https://127.0.0.1/file',
    'https://192.168.0.8/file',
    'https://10.0.0.5/file',
    'https://user:pass@storage.mds.yandex.net/file-download-info/1',
  ]
  for (const target of targets) {
    const result = await request('/api/yandex-fetch?url=' + encodeURIComponent(target), { cookie })
    assert.equal(result.status, 400, target)
    assert.equal(result.text.includes('pass'), false)
  }
  assert.equal(calls.length, 0)
})

test('allowed yandex metadata url is fetched without client credentials', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const target = 'https://storage.mds.yandex.net/file-download-info/1/2?format=json'
  const result = await request('/api/yandex-fetch?url=' + encodeURIComponent(target), {
    cookie,
    headers: { Authorization: 'OAuth browser-token', Cookie: 'extra=1' },
  })
  assert.equal(result.status, 200)
  assert.match(result.text, /s3\.mds\.yandex\.net/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, target)
  assert.equal(calls[0]?.headers.cookie, undefined)
  assert.equal(calls[0]?.headers.authorization, undefined)
})

test('redirect from yandex metadata to a forbidden host is rejected', async () => {
  const cookie = await sessionCookie()
  calls.length = 0
  const target = 'https://storage.mds.yandex.net/file-download-info/redirect'
  const result = await request('/api/yandex-fetch?url=' + encodeURIComponent(target), { cookie })
  assert.equal(result.status, 400)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, target)
  assert.equal(calls.some((call) => call.url.includes('10.0.0.9')), false)
})
