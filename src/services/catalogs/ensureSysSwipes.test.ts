import assert from 'node:assert/strict'
import test from 'node:test'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { LibraryHttpError } from '../libraryPersistence/client.ts'
import { ensureSysSwipesCategory } from './ensureSysSwipes.ts'
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
    await ensureSysSwipesCategory(() => true)
    assert.equal(loads, 1)
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      true,
    )
    assert.equal(
      useCollectionStore.getState().categories.find((row) => row.id === SYS_SWIPES_ID)
        ?.system,
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
  }
})

test('non-409 ensure error does not throw (soft-fail)', async () => {
  useCollectionStore.getState().clearUserLibrary()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(null, { status: 500 })) as typeof fetch
  try {
    await ensureSysSwipesCategory(() => true)
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === SYS_SWIPES_ID),
      false,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
  }
})
