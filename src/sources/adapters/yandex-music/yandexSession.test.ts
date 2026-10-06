import assert from 'node:assert/strict'
import test from 'node:test'
import { yandexMusicRequestHeaders } from './requestHeaders.ts'
import {
  disconnectYandexAccount,
  persistNewYandexSession,
  reconcileYandexConnection,
  type YandexLegacyStorage,
} from './reconcileSession.ts'
import { parseYandexStatusBody, saveYandexConnection } from './sessionClient.ts'
import type { YandexAuthSession } from './types.ts'

const legacySession: YandexAuthSession = {
  accessToken: 'legacy-token',
  refreshToken: 'legacy-refresh',
}

function memoryStorage(initial?: {
  legacy?: YandexAuthSession | null
  owner?: string | null
}): YandexLegacyStorage & { legacy: YandexAuthSession | null; owner: string | null; clears: number } {
  const state = {
    legacy: initial?.legacy ?? null,
    owner: initial?.owner ?? null,
    clears: 0,
  }
  return {
    ...state,
    readLegacy: async () => state.legacy,
    removeLegacy: async () => {
      state.legacy = null
    },
    readOwner: async () => state.owner,
    writeOwner: async (userId) => {
      state.owner = userId
    },
    clearLibrary: async () => {
      state.clears += 1
    },
    get legacy() {
      return state.legacy
    },
    get owner() {
      return state.owner
    },
    get clears() {
      return state.clears
    },
  }
}

test('existing backend connection restores Yandex and drops the legacy token', async () => {
  const storage = memoryStorage({ legacy: legacySession, owner: 'user-a' })
  const result = await reconcileYandexConnection({
    userId: 'user-a',
    readStatus: async () => ({
      kind: 'status',
      connected: true,
      profile: { displayName: 'Anya', hasPlus: true, uid: 11 },
    }),
    saveLegacy: async () => {
      throw new Error('legacy must not be saved when backend is connected')
    },
    storage,
  })

  assert.equal(result.connected, true)
  assert.equal(result.legacyRemoved, true)
  assert.equal(storage.legacy, null)
  assert.equal(result.profile?.displayName, 'Anya')
})

test('new device flow saves through the backend and not local storage', async () => {
  let saved: YandexAuthSession | null = null
  const profile = await persistNewYandexSession(
    { accessToken: 'transient-token', refreshToken: 'refresh' },
    async (session) => {
      saved = session
      return { displayName: 'Anya', hasPlus: false, uid: 11 }
    },
  )
  assert.equal(saved?.accessToken, 'transient-token')
  assert.equal(profile.displayName, 'Anya')
  assert.equal('accessToken' in profile, false)
})

test('successful legacy migration removes the local auth session', async () => {
  const storage = memoryStorage({ legacy: legacySession, owner: 'user-a' })
  let savedToken = ''
  const result = await reconcileYandexConnection({
    userId: 'user-a',
    readStatus: async () => ({ kind: 'status', connected: false, profile: null }),
    saveLegacy: async (session) => {
      savedToken = session.accessToken
      return { displayName: 'Anya', hasPlus: false, uid: 11 }
    },
    storage,
  })
  assert.equal(savedToken, 'legacy-token')
  assert.equal(result.migrated, true)
  assert.equal(result.connected, true)
  assert.equal(result.legacyRemoved, true)
  assert.equal(storage.legacy, null)
})

test('failed legacy migration keeps the local auth session and stays disconnected', async () => {
  const storage = memoryStorage({ legacy: legacySession, owner: 'user-a' })
  const result = await reconcileYandexConnection({
    userId: 'user-a',
    readStatus: async () => ({ kind: 'status', connected: false, profile: null }),
    saveLegacy: async () => {
      throw new Error('YANDEX_AUTH_REQUIRED')
    },
    storage,
  })
  assert.equal(result.connected, false)
  assert.equal(result.migrated, false)
  assert.equal(result.legacyRemoved, false)
  assert.equal(storage.legacy?.accessToken, 'legacy-token')
})

test('normal Yandex API requests do not attach a local token', () => {
  const headers = yandexMusicRequestHeaders()
  assert.deepEqual(headers, { Accept: 'application/json' })
  assert.equal('Authorization' in headers, false)
  assert.equal('authorization' in headers, false)
})

test('switching swipe users clears the previous Yandex cache', async () => {
  const storage = memoryStorage({ owner: 'user-a', legacy: null })
  const result = await reconcileYandexConnection({
    userId: 'user-b',
    readStatus: async () => ({ kind: 'status', connected: false, profile: null }),
    saveLegacy: async () => {
      throw new Error('no legacy')
    },
    storage,
  })
  assert.equal(storage.clears, 1)
  assert.equal(storage.owner, 'user-b')
  assert.equal(result.foreignCacheCleared, true)
  assert.equal(result.connected, false)
})

test('disconnect calls backend delete before clearing local state', async () => {
  const order: string[] = []
  await disconnectYandexAccount({
    deleteRemote: async () => {
      order.push('delete')
    },
    removeLegacy: async () => {
      order.push('legacy')
    },
    clearLibrary: async () => {
      order.push('cache')
    },
  })
  assert.deepEqual(order, ['delete', 'legacy', 'cache'])
})

test('status parsing drops any token echoed by a response', () => {
  const parsed = parseYandexStatusBody({
    connected: true,
    displayName: 'Anya',
    hasPlus: false,
    uid: 11,
    accessToken: 'should-not-surface',
    refreshToken: 'also-hidden',
  })
  assert.equal(parsed.kind, 'status')
  if (parsed.kind !== 'status') {
    return
  }
  assert.equal(parsed.connected, true)
  assert.equal(parsed.profile?.displayName, 'Anya')
  assert.equal(JSON.stringify(parsed).includes('should-not-surface'), false)
})

test('save request uses the swipe cookie and does not return the token', async () => {
  let credentials = ''
  let authorization = ''
  const profile = await saveYandexConnection(
    { accessToken: 'transient-token' },
    (async (_url, init) => {
      credentials = init?.credentials ?? ''
      const headers = init?.headers as Record<string, string>
      authorization = headers.Authorization ?? headers.authorization ?? ''
      return new Response(
        JSON.stringify({
          connected: true,
          displayName: 'Anya',
          hasPlus: false,
          uid: 11,
          accessToken: 'transient-token',
        }),
        { status: 200 },
      )
    }) as typeof fetch,
  )
  assert.equal(credentials, 'include')
  assert.equal(authorization, '')
  assert.equal(profile.displayName, 'Anya')
  assert.equal(JSON.stringify(profile).includes('transient-token'), false)
})
