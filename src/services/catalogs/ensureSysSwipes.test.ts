import assert from 'node:assert/strict'
import test from 'node:test'
import { useCollectionStore } from '../../store/collectionStore.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError } from '../libraryPersistence/client.ts'
import { resetLibrarySession } from '../libraryPersistence/session.ts'
import {
  clearSysSwipesEnsureRecovery,
  ensureSysSwipesCategory,
  getSysSwipesEnsureRecovery,
} from './ensureSysSwipes.ts'
import { SYS_SWIPES_ID } from './systemFolders.ts'

function resetSession(userId: string | null = 'user-a'): void {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch(userId)
  clearSysSwipesEnsureRecovery()
}

test('409 on create merges server category without throwing', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let loads = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && !url.includes('library-state')) {
      return new Response(JSON.stringify({ error: 'CATEGORY_EXISTS' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/api/me/library-state')) {
      loads += 1
      return new Response(
        JSON.stringify({
          categories: [
            {
              id: SYS_SWIPES_ID,
              name: 'Свайпы',
              icon: 'star',
              color: '#0d9488',
              description: '',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
              sortOrder: -100,
              favorite: false,
              system: true,
            },
          ],
          tracks: [],
          categoryAssignments: [],
          history: [],
          settings: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    const result = await ensureSysSwipesCategory(() => true)
    assert.equal(result.status, 'ready')
    assert.equal(loads, 1)
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})

test('409 with failed GET does not synthesize local sys_swipes', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && !url.includes('library-state')) {
      return new Response(null, { status: 409 })
    }
    if (url.includes('/api/me/library-state')) {
      return new Response(null, { status: 500 })
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    const result = await ensureSysSwipesCategory(() => true)
    assert.equal(result.status, 'recoverable')
    if (result.status === 'recoverable') {
      assert.equal(result.reason, 'conflict_reload_failed')
    }
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      false,
    )
    const recovery = getSysSwipesEnsureRecovery()
    assert.equal(recovery?.status, 'recoverable')
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})

test('create failure is recoverable and retry can succeed', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let failCreate = true
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      if (failCreate) {
        return new Response(null, { status: 500 })
      }
      return new Response(null, { status: 204 })
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    const first = await ensureSysSwipesCategory(() => true)
    assert.equal(first.status, 'recoverable')
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      false,
    )
    failCreate = false
    const second = await ensureSysSwipesCategory(() => true)
    assert.equal(second.status, 'created')
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})

test('recoverable ensure status does not leak across accounts', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(null, { status: 500 })
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    const first = await ensureSysSwipesCategory(() => true)
    assert.equal(first.status, 'recoverable')
    assert.equal(getSysSwipesEnsureRecovery()?.status, 'recoverable')

    bindAuthSessionEpoch('user-b')
    assert.equal(getSysSwipesEnsureRecovery(), null)

    const forB = await ensureSysSwipesCategory(() => true)
    assert.equal(forB.status, 'recoverable')
    assert.equal(getSysSwipesEnsureRecovery()?.status, 'recoverable')
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})

test('logout clears ensure recovery via resetLibrarySession', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(null, { status: 500 })
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    await ensureSysSwipesCategory(() => true)
    assert.equal(getSysSwipesEnsureRecovery()?.status, 'recoverable')
    resetLibrarySession()
    assert.equal(getSysSwipesEnsureRecovery(), null)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})

test('stale ensure after session switch does not merge for next user', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolvePost!: (value: Response) => void
  const postGate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return postGate
    }
    throw new LibraryHttpError(404)
  }) as typeof fetch

  try {
    const pending = ensureSysSwipesCategory(() => true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    bindAuthSessionEpoch('user-b')
    resolvePost(new Response(null, { status: 204 }))
    const result = await pending
    assert.equal(result.status, 'recoverable')
    if (result.status === 'recoverable') {
      assert.equal(result.reason, 'stale')
    }
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      false,
    )

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/me/categories') && init?.method === 'POST') {
        return new Response(null, { status: 204 })
      }
      throw new LibraryHttpError(404)
    }) as typeof fetch
    const forB = await ensureSysSwipesCategory(() => true)
    assert.equal(forB.status, 'created')
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
    clearSysSwipesEnsureRecovery()
  }
})
