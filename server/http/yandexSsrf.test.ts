import assert from 'node:assert/strict'
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
import { isForbiddenAddress, validateMetadataTarget } from './yandexFetchPolicy.ts'
import { pinnedRequestOptions } from './pinnedHttps.ts'
import type { MetadataHop, MetadataTransport } from './yandexEdge.ts'

const directory = mkdtempSync(join(tmpdir(), 'swipemusic-ssrf-'))
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
const allowedUrl = 'https://storage.mds.yandex.net/file-download-info/track'

test('private, mapped, and non-yandex targets are rejected before a connection', async () => {
  assert.equal(isForbiddenAddress('::1'), true)
  assert.equal(isForbiddenAddress('::ffff:127.0.0.1'), true)
  assert.equal(isForbiddenAddress('::ffff:10.1.2.3'), true)
  assert.equal(isForbiddenAddress('169.254.169.254'), true)
  assert.equal(isForbiddenAddress('77.88.8.8'), false)

  let lookups = 0
  const resolveHost = async () => {
    lookups += 1
    return ['77.88.8.8']
  }
  const blocked = [
    'http://storage.mds.yandex.net/file-download-info/1',
    'https://storage.mds.yandex.net:8443/file-download-info/1',
    'https://example.com/file',
    'https://localhost/file',
    'https://127.0.0.1/file',
    'https://[::1]/file',
    'https://[::ffff:127.0.0.1]/file',
    'https://2130706433/file',
    'https://user:pass@storage.mds.yandex.net/file',
  ]
  for (const target of blocked) {
    assert.equal((await validateMetadataTarget(target, resolveHost)).ok, false, target)
  }
  assert.equal(lookups, 0)

  assert.equal((await validateMetadataTarget(allowedUrl, async () => ['127.0.0.1'])).ok, false)
  assert.equal((await validateMetadataTarget(allowedUrl, async () => ['::1'])).ok, false)
  assert.equal((await validateMetadataTarget(allowedUrl, async () => ['::ffff:192.168.0.8'])).ok, false)
  assert.equal((await validateMetadataTarget(allowedUrl, async () => {
    throw new Error('dns failed')
  })).ok, false)
})

test('pinned connection uses the checked address and keeps TLS hostname verification', () => {
  assert.throws(() => pinnedRequestOptions(new URL(allowedUrl), '127.0.0.1', 1000))
  assert.throws(() => pinnedRequestOptions(new URL('https://evil.example/file'), '77.88.8.8', 1000))
  const options = pinnedRequestOptions(new URL(`${allowedUrl}?format=json`), '77.88.8.8', 1000)
  assert.equal(options.host, '77.88.8.8')
  assert.equal(options.servername, 'storage.mds.yandex.net')
  assert.equal(options.port, 443)
  assert.equal(options.rejectUnauthorized, true)
  assert.equal(options.headers && (options.headers as Record<string, string>).Host, 'storage.mds.yandex.net')
  const lookup = options.lookup
  assert.equal(typeof lookup, 'function')
  if (typeof lookup !== 'function') {
    return
  }
  lookup('127.0.0.1', {}, (error, address, family) => {
    assert.equal(error, null)
    assert.equal(address, '77.88.8.8')
    assert.equal(family, 4)
  })
})

async function start(options: {
  resolveMetadataHost: (hostname: string) => Promise<string[]>
  metadataTransport: MetadataTransport
  upstreamTimeoutMs?: number
  metadataBodyLimit?: number
}): Promise<(path: string) => Promise<{ status: number; text: string }>> {
  const server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(20, 60_000),
    ...createRelaxedAuthGuards(),
    ...options,
  })
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('ssrf test server has no port')
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
      email: `ssrf-${servers.length}@example.com`,
      password: 'correct-horse',
    }),
  })
  const cookie = register.headers.get('set-cookie')?.split(';')[0]
  assert.equal(register.status, 201)
  assert.ok(cookie)
  return async (path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' },
    })
    return { status: response.status, text: await response.text() }
  }
}

test('dns rebinding cannot move the connection onto a private address', async () => {
  const seen: string[] = []
  let lookups = 0
  const request = await start({
    resolveMetadataHost: async () => {
      lookups += 1
      return lookups === 1 ? ['77.88.8.8'] : ['127.0.0.1']
    },
    metadataTransport: async (hop: MetadataHop) => {
      seen.push(hop.address)
      assert.equal(isForbiddenAddress(hop.address), false)
      return new Response('<download-info><host>s3.mds.yandex.net</host></download-info>', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    },
  })
  const result = await request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(result.status, 200)
  assert.match(result.text, /s3\.mds\.yandex\.net/)
  assert.deepEqual(seen, ['77.88.8.8'])
  assert.equal(lookups, 1)
})

test('redirects to private or unexpected targets are not followed', async () => {
  const seen: string[] = []
  const request = await start({
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: async (hop: MetadataHop) => {
      seen.push(hop.url.toString())
      const location = hop.url.pathname.endsWith('/port')
        ? 'https://storage.mds.yandex.net:8443/secret'
        : 'https://10.0.0.9/secret'
      return new Response('', { status: 302, headers: { location } })
    },
  })
  const privateRedirect = await request(`/api/yandex-fetch?url=${encodeURIComponent(`${allowedUrl}/redirect`)}`)
  const portRedirect = await request(`/api/yandex-fetch?url=${encodeURIComponent(`${allowedUrl}/port`)}`)
  assert.equal(privateRedirect.status, 400)
  assert.equal(portRedirect.status, 400)
  assert.equal(seen.some((url) => url.includes('10.0.0.9') || url.includes(':8443')), false)
})

test('a second dns answer is not used when the redirect host is rechecked', async () => {
  const seen: string[] = []
  let lookups = 0
  const request = await start({
    resolveMetadataHost: async () => {
      lookups += 1
      return lookups === 1 ? ['77.88.8.8'] : ['10.1.1.1']
    },
    metadataTransport: async (hop: MetadataHop) => {
      seen.push(hop.address)
      return new Response('', {
        status: 302,
        headers: { location: 'https://storage.mds.yandex.net/file-download-info/next' },
      })
    },
  })
  const result = await request(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(result.status, 400)
  assert.deepEqual(seen, ['77.88.8.8'])
  assert.equal(lookups, 2)
})

test('hung upstream and oversized metadata stop safely', async () => {
  const hung = await start({
    upstreamTimeoutMs: 40,
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: () => new Promise(() => {}),
  })
  const started = Date.now()
  const timeout = await hung(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(timeout.status, 504)
  assert.equal(JSON.parse(timeout.text).error, 'UPSTREAM_TIMEOUT')
  assert.ok(Date.now() - started < 1000)

  const oversized = await start({
    metadataBodyLimit: 16,
    resolveMetadataHost: async () => ['77.88.8.8'],
    metadataTransport: async () => new Response('x'.repeat(64), {
      status: 200,
      headers: { 'content-type': 'application/xml', 'content-length': '64' },
    }),
  })
  const tooLarge = await oversized(`/api/yandex-fetch?url=${encodeURIComponent(allowedUrl)}`)
  assert.equal(tooLarge.status, 502)
  assert.equal(tooLarge.text.includes('x'.repeat(32)), false)
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
