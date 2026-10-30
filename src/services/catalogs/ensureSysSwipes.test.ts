import assert from 'node:assert/strict'
import test from 'node:test'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { LibraryHttpError } from '../libraryPersistence/client.ts'
import {
  ensureSysSwipesCategory,
  getSysSwipesEnsureRecovery,
} from './ensureSysSwipes.ts'
import { SYS_SWIPES_ID } from './systemFolders.ts'

test('409 on create merges server category without throwing', async () => {
  useCollectionStore.getState().clearUserLibrary()
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
  }
})

test('409 with failed GET does not synthesize local sys_swipes', async () => {
  useCollectionStore.getState().clearUserLibrary()
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
  }
})

test('create failure is recoverable and retry can succeed', async () => {
  useCollectionStore.getState().clearUserLibrary()
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
  }
})
