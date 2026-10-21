import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createRelaxedAuthGuards } from '../auth/guards.ts'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from './server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'
import type { YandexUpstream } from '../providers/yandexSession.ts'
import type { MetadataTransport } from './yandexEdge.ts'
import { MAX_MUSIC_UPSTREAM_BODY } from './yandexRoutes.ts'

const directory = mkdtempSync(join(tmpdir(), 'swipemusic-upstream-'))
const servers: Server[] = []
const databases: DatabaseSync[] = []
const password = 'correct-horse'
const token = 'ya-secret-token-a'
const allowedUrl = 'https://storage.mds.yandex.net/file-download-info/track'
let sequence = 0

function hangingBody(contentType: string): Response {
  return new Response(
    new ReadableStream({
      start() {},
    }),
    { status: 200, headers: { 'content-type': contentType } },
  )
}

function oversizedBody(marker: string, extra: number, contentType: string): Response {
  const encoded = new TextEncoder().encode(marker + 'x'.repeat(extra))
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': contentType } },
  )
}

function accountStatus(): Response {
  return new Response(
    JSON.stringify({
      result: {
        account: { uid: 11, displayName: 'Anya' },
        plus: { hasPlus: false },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

async function boot(options: {
  yandexOauthUpstream?: YandexUpstream
  yandexUpstream?: YandexUpstream
  metadataTransport?: MetadataTransport
  resolveMetadataHost?: (hostname: string) => Promise<string[]>
  upstreamTimeoutMs?: number
  musicBodyLimit?: number
  metadataBodyLimit?: number
  withYandexSession?: boolean
}): Promise<{
  request: (
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => Promise<{ status: number; text: string }>
}> {
  sequence += 1
  const databasePath = join(directory, `case-${sequence}.sqlite`)
  const db = openDatabase(databasePath)
  databases.push(db)
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_PATH: databasePath,
    APP_PUBLIC_URL: 'http://127.0.0.1:5173',
    MAIL_TRANSPORT: 'memory',
    PROVIDER_SESSION_KEY: randomBytes(32).toString('base64'),
  })
  const server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 60_000),
    ...createRelaxedAuthGuards(),
    upstreamTimeoutMs: options.upstreamTimeoutMs ?? 80,
    ...options,
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('upstream limit test server has no port')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({
      firstName: 'Аня',
      lastName: 'Смирнова',
      email: `upstream-${sequence}@example.com`,
      password,
    }),
  })
  const cookie = register.headers.get('set-cookie')?.split(';')[0]
  assert.equal(register.status, 201)
  assert.ok(cookie)

  if (options.withYandexSession) {
    const saved = await fetch(`${baseUrl}/api/me/providers/yandex/session`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
        Cookie: cookie,
      },
      body: JSON.stringify({ accessToken: token }),
    })
    assert.equal(saved.status, 200)
  }

  return {
    request: async (path, init) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Origin: 'http://127.0.0.1:5173',
          Cookie: cookie,
          ...(init?.headers ?? {}),
        },
        body: init?.body,
      })
      return { status: response.status, text: await response.text() }
    },
  }
}

async function expectTimeout(
  run: () => Promise<{ status: number; text: string }>,
): Promise<{ status: number; text: string }> {
  const started = Date.now()
  const result = await run()
  assert.equal(result.status, 504)
  assert.equal(JSON.parse(result.text).error, 'UPSTREAM_TIMEOUT')
  assert.ok(Date.now() - started < 1000)
  return result
}

test('music upstream body limit covers a real library response', () => {
  assert.equal(MAX_MUSIC_UPSTREAM_BODY, 32 * 1024 * 1024)
})

test('oauth deadline aborts a hung connection, a hung body, and an oversized body', async () => {
  const state: { signal?: AbortSignal } = {}
  const hungConnect = await boot({
    yandexOauthUpstream: (_url, init) => {
      state.signal = init?.signal ?? undefined
      return new Promise(() => {})
    },
  })
  await expectTimeout(() =>
    hungConnect.request('/api/yandex-oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=device_code&code=device',
    }),
  )
  assert.equal(state.signal?.aborted, true)

  const hungBody = await boot({
    yandexOauthUpstream: (_url, init) => {
      state.signal = init?.signal ?? undefined
      return Promise.resolve(hangingBody('application/json'))
    },
  })
  await expectTimeout(() =>
    hungBody.request('/api/yandex-oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=device_code&code=device',
    }),
  )
  assert.equal(state.signal?.aborted, true)

  const marker = 'OAUTH-OVERSIZE'
  const oversized = await boot({
    yandexOauthUpstream: async () => oversizedBody(marker, 20_000, 'application/json'),
  })
  const tooLarge = await oversized.request('/api/yandex-oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=device_code&code=device',
  })
  assert.equal(tooLarge.status, 502)
  assert.equal(JSON.parse(tooLarge.text).error, 'UPSTREAM')
  assert.equal(tooLarge.text.includes(marker), false)

  const normal = await boot({
    yandexOauthUpstream: async () =>
      new Response(
        JSON.stringify({
          device_code: 'device',
          user_code: 'ABCD1234',
          verification_url: 'https://oauth.yandex.ru/device',
          interval: 5,
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  })
  const ok = await normal.request('/api/yandex-oauth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=music',
  })
  assert.equal(ok.status, 200)
  assert.match(ok.text, /ABCD1234/)
})

test('yandex music deadline covers the body and rejects an oversized playlist', async () => {
  const state: { signal?: AbortSignal } = {}
  const playlist = '/api/yandex-music/users/11/playlists/3'

  const hungConnect = await boot({
    withYandexSession: true,
    musicBodyLimit: 64,
    yandexUpstream: (url, init) => {
      if (url.endsWith('/account/status')) {
        return Promise.resolve(accountStatus())
      }
      state.signal = init?.signal ?? undefined
      return new Promise(() => {})
    },
  })
  await expectTimeout(() => hungConnect.request(playlist))
  assert.equal(state.signal?.aborted, true)

  const hungBody = await boot({
    withYandexSession: true,
    musicBodyLimit: 64,
    yandexUpstream: (url, init) => {
      if (url.endsWith('/account/status')) {
        return Promise.resolve(accountStatus())
      }
      state.signal = init?.signal ?? undefined
      return Promise.resolve(hangingBody('application/json'))
    },
  })
  await expectTimeout(() => hungBody.request(playlist))
  assert.equal(state.signal?.aborted, true)

  const marker = 'PLAYLIST-OVERSIZE'
  const oversized = await boot({
    withYandexSession: true,
    musicBodyLimit: 64,
    yandexUpstream: (url) => {
      if (url.endsWith('/account/status')) {
        return Promise.resolve(accountStatus())
      }
      return Promise.resolve(oversizedBody(marker, 200, 'application/json'))
    },
  })
  const tooLarge = await oversized.request(playlist)
  assert.equal(tooLarge.status, 502)
  assert.equal(JSON.parse(tooLarge.text).error, 'UPSTREAM')
  assert.equal(tooLarge.text.includes(marker), false)
  assert.equal(tooLarge.text.includes(token), false)

  const normal = await boot({
    withYandexSession: true,
    yandexUpstream: (url) => {
      if (url.endsWith('/account/status')) {
        return Promise.resolve(accountStatus())
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              title: 'Ночной',
              tracks: [{ id: 1, title: 'Трек' }],
              note: token,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    },
  })
  const ok = await normal.request('/api/yandex-music/users/11/likes/tracks')
  assert.equal(ok.status, 200)
  assert.match(ok.text, /Ночной/)
  assert.match(ok.text, /\[redacted\]/)
  assert.equal(ok.text.includes(token), false)
})

test('metadata dns and body stay inside the request deadline', async () => {
  let connects = 0
  const dnsHang = await boot({
    resolveMetadataHost: () => new Promise(() => {}),
    metadataTransport: () => {
      connects += 1
      throw new Error('dns hang must not open a connection')
    },
  })
  await expectTimeout(() => dnsHang.request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`))
  assert.equal(connects, 0)

  let lookups = 0
  const redirectDns = await boot({
    resolveMetadataHost: () => {
      lookups += 1
      if (lookups === 1) {
        return Promise.resolve(['77.88.8.8'])
      }
      return new Promise(() => {})
    },
    metadataTransport: () => {
      connects += 1
      return Promise.resolve(
        new Response('', {
          status: 302,
          headers: { location: 'https://storage.mds.yandex.net/file-download-info/next' },
        }),
      )
    },
  })
  await expectTimeout(() => redirectDns.request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`))
  assert.equal(connects, 1)
  assert.equal(lookups, 2)

  const state: { signal?: AbortSignal } = {}
  const hungBody = await boot({
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: (_hop, init) => {
      state.signal = init.signal ?? undefined
      return Promise.resolve(hangingBody('application/xml'))
    },
  })
  await expectTimeout(() => hungBody.request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`))
  assert.equal(state.signal?.aborted, true)

  const marker = 'META-OVERSIZE'
  const oversized = await boot({
    metadataBodyLimit: 32,
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: async () => oversizedBody(marker, 80, 'application/xml'),
  })
  const tooLarge = await oversized.request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(tooLarge.status, 502)
  assert.equal(tooLarge.text.includes(marker), false)

  const normal = await boot({
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: async (hop) => {
      assert.equal(hop.address, '77.88.8.8')
      return new Response('<download-info><host>s3.mds.yandex.net</host></download-info>', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    },
  })
  const ok = await normal.request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(ok.status, 200)
  assert.match(ok.text, /s3\.mds\.yandex\.net/)
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
  for (const db of databases) {
    db.close()
  }
  rmSync(directory, { recursive: true, force: true })
})
