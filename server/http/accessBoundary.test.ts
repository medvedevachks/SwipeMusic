import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, before, test } from 'node:test'
import { createRelaxedAuthGuards } from '../auth/guards.ts'
import { createForgotPasswordLimiter } from '../auth/rateLimit.ts'
import { loadConfig } from '../config/env.ts'
import { openDatabase } from '../db/database.ts'
import { listenAuthServer } from './server.ts'
import { createMemoryMailSender } from '../mail/memoryMailSender.ts'

const password = 'correct-horse'
const directory = mkdtempSync(join(tmpdir(), 'swipemusic-access-'))
const databasePath = join(directory, 'test.sqlite')
const db = openDatabase(databasePath)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_PATH: databasePath,
  APP_PUBLIC_URL: 'http://127.0.0.1:5173',
  MAIL_TRANSPORT: 'memory',
})
const repoRoot = join(import.meta.dirname, '..', '..')

let server: Server
let baseUrl = ''

type ApiResult = { status: number; text: string; body: Record<string, unknown> }

async function api(
  path: string,
  options: { method?: string; body?: string; cookie?: string | null; json?: boolean } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { Origin: 'http://127.0.0.1:5173' }
  if (options.cookie) {
    headers.Cookie = options.cookie
  }
  if (options.json !== false && options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = {}
  }
  return { status: response.status, text, body }
}

function assertNoInternals(text: string): void {
  assert.equal(text.includes('password_hash'), false)
  assert.equal(text.includes('BEGIN PRIVATE'), false)
  assert.equal(text.includes('BEGIN OPENSSH'), false)
  assert.equal(/[A-Z]:\\/.test(text), false)
  assert.equal(text.includes('node:sqlite'), false)
  assert.equal(text.includes('at listenAuthServer'), false)
  assert.equal(text.includes('for 16-bit app support'), false)
  assert.equal(text.includes('ref: refs/'), false)
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

before(async () => {
  server = await listenAuthServer({
    db,
    config,
    mail: createMemoryMailSender(),
    limiter: createForgotPasswordLimiter(100, 60_000),
    ...createRelaxedAuthGuards(),
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('access boundary server has no port')
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

async function register(email: string): Promise<{ cookie: string; id: string }> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName: 'Аня',
      lastName: 'Смирнова',
      email,
      password,
    }),
  })
  assert.equal(response.status, 201)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  const me = await api('/api/auth/me', { cookie })
  assert.equal(me.status, 200)
  const user = me.body.user as { id: string }
  return { cookie, id: user.id }
}

test('unauthenticated client cannot read other users, library, or tokens', async () => {
  const owner = await register('access-owner@example.com')
  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: JSON.stringify({
      id: 'cat_access',
      name: 'Ночь',
      icon: 'moon',
      color: '#102030',
    }),
  })
  assert.equal(created.status, 201)

  const paths = [
    '/api/auth/me',
    '/api/me/library-state',
    '/api/me/categories',
    '/api/me/collection',
    '/api/me/settings',
    '/api/me/canonical-library',
    '/api/me/providers/yandex/status',
    '/api/yandex-music/account/status',
    '/api/yandex-fetch?url=https%3A%2F%2Fstorage.mds.yandex.net%2Ffile',
  ]
  for (const path of paths) {
    const result = await api(path)
    assert.equal(result.status, 401, path)
    assert.equal(result.body.error, 'UNAUTHENTICATED')
    assert.equal(result.text.includes('access-owner@example.com'), false)
    assert.equal(result.text.includes('Ночь'), false)
    assertNoInternals(result.text)
  }
})

test('request userId does not change the owner and errors stay generic', async () => {
  const owner = await register('access-a@example.com')
  const other = await register('access-b@example.com')
  const spoofed = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: JSON.stringify({
      id: 'cat_spoof',
      name: 'Чужое',
      icon: 'star',
      color: '#abcdef',
      userId: other.id,
      user_id: other.id,
    }),
  })
  assert.equal(spoofed.status, 400)
  assertNoInternals(spoofed.text)

  const byQuery = await api(`/api/me/categories?userId=${encodeURIComponent(other.id)}`, {
    cookie: owner.cookie,
  })
  assert.equal(byQuery.status, 200)
  assert.deepEqual(byQuery.body.categories, [])

  const otherList = await api('/api/me/categories', { cookie: other.cookie })
  assert.deepEqual(otherList.body.categories, [])

  const badJson = await api('/api/auth/login', { method: 'POST', body: '{' })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.body.error, 'VALIDATION')
  assertNoInternals(badJson.text)

  const huge = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'huge@example.com', password: 'x'.repeat(1_100_000) }),
  })
  assert.equal(huge.status, 400)
  assert.equal(huge.text.includes('x'.repeat(80)), false)
  assertNoInternals(huge.text)
})

test('suspicious paths do not read files or start a shell', async () => {
  const serverFiles = walk(join(repoRoot, 'server')).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  )
  assert.ok(serverFiles.length > 0)
  for (const file of serverFiles) {
    const source = readFileSync(file, 'utf8')
    assert.equal(source.includes('node:child_process'), false, relative(repoRoot, file))
    assert.equal(source.includes('child_process'), false, relative(repoRoot, file))
    assert.equal(source.includes('powershell'), false, relative(repoRoot, file))
    assert.equal(source.includes('cmd.exe'), false, relative(repoRoot, file))
  }

  const paths = [
    '/.git/HEAD',
    '/.env',
    '/production.env',
    '/secrets/provider-session.key',
    '/server/index.ts',
    '/api/../../.env',
    '/api/yandex-music/../../Windows/win.ini',
    '/api/%2e%2e/%2e%2e/Windows/System32/cmd.exe',
    '/api/admin/powershell',
  ]
  for (const path of paths) {
    const result = await api(path, {
      method: path.endsWith('powershell') ? 'POST' : 'GET',
      body: path.endsWith('powershell') ? JSON.stringify({ command: 'whoami' }) : undefined,
    })
    assert.ok(result.status === 401 || result.status === 404, `${path} -> ${result.status}`)
    assertNoInternals(result.text)
    assert.equal(result.text.includes('whoami'), false)
  }
})

test('sql payload is stored as data and does not change the schema', async () => {
  const owner = await register('access-sql@example.com')
  const payload = `' OR 1=1; DROP TABLE users; --`
  const before = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
    name: string
  }>
  const created = await api('/api/me/categories', {
    method: 'POST',
    cookie: owner.cookie,
    body: JSON.stringify({
      id: 'cat_sql',
      name: payload,
      icon: 'book',
      color: '#112233',
    }),
  })
  assert.equal(created.status, 201)
  const category = created.body.category as { name: string }
  assert.equal(category.name, payload)

  const after = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{
    name: string
  }>
  assert.deepEqual(after, before)
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  assert.ok(users.count >= 1)
  const row = db.prepare('SELECT name FROM user_categories WHERE id = ?').get('cat_sql') as { name: string }
  assert.equal(row.name, payload)
})

test('gitignore and dist do not publish runtime secrets', () => {
  const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
  for (const entry of ['.env', 'dist', '.data/', '.certs/', '/data/', '/secrets/']) {
    assert.equal(gitignore.includes(entry), true, entry)
  }

  const secretName = /(^|\/)(production\.env|provider-session\.key|\.env|id_rsa)|\.(pem|key|sqlite|sqlite3)$/i
  for (const file of walk(join(repoRoot, 'public'))) {
    assert.equal(secretName.test(file.replaceAll('\\', '/')), false, file)
  }

  const dist = join(repoRoot, 'dist')
  if (!existsSync(dist)) {
    return
  }
  for (const file of walk(dist)) {
    const portable = file.replaceAll('\\', '/')
    assert.equal(secretName.test(portable), false, portable)
    if (!/\.(html|js|css|svg|webmanifest|txt|json)$/i.test(file)) {
      continue
    }
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes('BEGIN PRIVATE KEY'), false, portable)
    assert.equal(text.includes('BEGIN OPENSSH PRIVATE KEY'), false, portable)
    assert.equal(text.includes('PROVIDER_SESSION_KEY='), false, portable)
  }
})
