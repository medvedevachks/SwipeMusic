import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createRelaxedAuthGuards } from '../../auth/guards.ts'
import { createForgotPasswordLimiter, createTasteProfileLimiter } from '../../auth/rateLimit.ts'
import { loadConfig } from '../../config/env.ts'
import { openDatabase } from '../../db/database.ts'
import { listenAuthServer } from '../../http/server.ts'
import { createMemoryMailSender } from '../../mail/memoryMailSender.ts'
import { boundTasteProfileResponse } from './presentTasteProfile.ts'
import type { UserTasteProfile } from '../../../src/services/taste/types.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-taste-route-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const loaded = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
const config = { ...loaded, nodeEnv: 'production' }
const limiter = createTasteProfileLimiter({ limit: 3, windowMs: 60_000 })

let server: Server
let baseUrl = ''

type ApiResult = {
  status: number
  body: Record<string, unknown>
  cookie: string | null
  retryAfter: string | null
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
  const setCookie = response.headers.get('set-cookie')
  const text = await response.text()
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    cookie: setCookie ? (setCookie.split(';')[0] ?? null) : null,
    retryAfter: response.headers.get('retry-after'),
  }
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 60_000),
    tasteProfileLimiter: limiter,
    ...createRelaxedAuthGuards(),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('taste route test server has no port')
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

async function register(email: string) {
  return api('/api/auth/register', {
    method: 'POST',
    body: { firstName: 'Аня', lastName: 'Смирнова', email, password },
  })
}

test('production taste profile belongs only to the session and stays bounded', async () => {
  const route = readFileSync(new URL('../../http/libraryRoutes.ts', import.meta.url), 'utf8')
  assert.equal(route.includes("nodeEnv !== 'development'"), false)
  assert.equal(route.includes('url.searchParams'), true)

  const guest = await api('/api/me/taste-profile')
  assert.equal(guest.status, 401)

  const anna = await register('taste-a@example.com')
  const boris = await register('taste-b@example.com')
  const saved = await api('/api/me/collection/tracks/yandex-music%3Awave-a', {
    method: 'PUT',
    cookie: anna.cookie,
    body: {
      sourceId: 'yandex-music',
      externalId: 'wave-a',
      title: 'Только Аня',
      artist: 'Поле',
      durationMs: 180_000,
      liked: true,
      likedAt: '2026-10-28T00:00:00.000Z',
    },
  })
  assert.equal(saved.status, 200)
  assert.equal((await api('/api/me/canonical-library', { cookie: anna.cookie })).status, 200)

  const own = await api('/api/me/taste-profile?userId=someone-else', { cookie: anna.cookie })
  const second = await api('/api/me/taste-profile', { cookie: anna.cookie })
  const third = await api('/api/me/taste-profile', { cookie: anna.cookie })
  const foreign = await api('/api/me/taste-profile', { cookie: boris.cookie })
  assert.equal(own.status, 200)
  assert.equal(second.status, 200)
  assert.equal(third.status, 200)
  assert.equal(foreign.status, 200)
  const ownProfile = own.body.profile as { userId: string }
  const foreignText = JSON.stringify(foreign.body)
  const ownText = JSON.stringify(own.body)
  assert.equal(ownProfile.userId, (anna.body.user as { id: string }).id)
  assert.equal(ownText.includes('Только Аня'), true)
  assert.equal(foreignText.includes('Только Аня'), false)
  assert.equal(foreignText.includes(ownProfile.userId), false)
  assert.equal(ownText.includes('access_token'), false)
  assert.equal(ownText.includes('streamUrl'), false)
  assert.equal(Object.keys(own.body).join(','), 'profile')

  const limited = await api('/api/me/taste-profile', { cookie: anna.cookie })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.error, 'RATE_LIMITED')
  assert.ok(Number(limited.retryAfter) >= 1)

  const bulky = {
    schemaVersion: 1,
    userId: 'user',
    builtAt: '2026-10-28T00:00:00.000Z',
    empty: false,
    tracks: Array.from({ length: 501 }, (_, index) => ({
      key: { kind: 'canonical' as const, canonicalTrackId: `id-${index}` },
      label: null,
      copies: [],
      score: index,
      signals: [],
      lastPlayed: null,
    })),
    catalogs: [],
    recentActivity: [],
  } satisfies UserTasteProfile
  const bounded = boundTasteProfileResponse(bulky)
  const top = bounded.tracks[0]?.key
  assert.equal(bounded.tracks.length, 500)
  assert.equal(top?.kind === 'canonical' ? top.canonicalTrackId : '', 'id-500')
})
