import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Category } from '../../types/category.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
  StaleLibrarySessionError,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError } from '../libraryPersistence/client.ts'
import {
  applyCategoryDeletedLocally,
  CatalogSyncAmbiguousError,
  clearCatalogCrudFlightsForTests,
  createCategoryConfirmed,
  deleteCategoryConfirmed,
  updateCategoryConfirmed,
} from './catalogCrudConfirmed.ts'

const NOW = '2026-11-09T12:00:00.000Z'

function resetSession(userId: string | null = 'user-a'): void {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch(userId)
  clearCatalogCrudFlightsForTests()
  useCollectionStore.getState().clearUserLibrary()
  useCanonicalLibraryStore.getState().clear()
}

function seedCatalog(partial: Partial<Category> & Pick<Category, 'id' | 'name'>): Category {
  const category: Category = {
    id: partial.id,
    name: partial.name,
    color: partial.color ?? '#2563eb',
    icon: partial.icon ?? 'music',
    description: partial.description ?? '',
    createdAt: partial.createdAt ?? NOW,
    updatedAt: partial.updatedAt ?? NOW,
    sortOrder: partial.sortOrder ?? 0,
    favorite: partial.favorite ?? false,
    system: partial.system ?? false,
  }
  useCollectionStore.setState({
    categories: [...useCollectionStore.getState().categories, category],
  })
  return category
}

function seedMembership(catalogId: string, canonicalId: string): void {
  const item: CanonicalLibraryItem = {
    canonicalTrack: {
      id: canonicalId,
      title: 'Track',
      artist: 'Artist',
      album: null,
      artworkUrl: null,
      durationMs: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [],
    catalogIds: [catalogId],
    state: {
      liked: true,
      likedAt: NOW,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: false,
      playCount: 0,
      lastPlayed: null,
      addedAt: NOW,
      customMetadata: {},
    },
  }
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item])
}

function emptyLibraryStateResponse(): Response {
  return new Response(
    JSON.stringify({
      categories: [],
      tracks: [],
      categoryAssignments: [],
      history: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function libraryStateWithCategory(category: {
  id: string
  name: string
}): Response {
  return new Response(
    JSON.stringify({
      categories: [
        {
          id: category.id,
          name: category.name,
          color: '#2563eb',
          icon: 'star',
          description: '',
          createdAt: NOW,
          updatedAt: NOW,
          sortOrder: 0,
          favorite: false,
          system: false,
        },
      ],
      tracks: [],
      categoryAssignments: [],
      history: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

test('CREATE success merges only after 204', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolvePost!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      return emptyLibraryStateResponse()
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return gate
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Отпуск',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_fixed',
    })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(useCollectionStore.getState().categories.length, 0)
    resolvePost(new Response(null, { status: 204 }))
    const created = await pending
    assert.equal(created.id, 'cat_fixed')
    assert.equal(useCollectionStore.getState().categories.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE 500 does not merge locally', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      return emptyLibraryStateResponse()
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(JSON.stringify({ error: 'SERVER' }), { status: 500 })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch
  try {
    await assert.rejects(
      () =>
        createCategoryConfirmed({
          name: 'Fail',
          color: '#2563eb',
          icon: 'star',
          id: 'cat_fail',
        }),
      (error: unknown) => error instanceof LibraryHttpError && error.status === 500,
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE network failure without server proof stays ambiguous and keeps local empty', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      throw new TypeError('Failed to fetch')
    }
    if (url.includes('/api/me/library-state')) {
      return emptyLibraryStateResponse()
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    await assert.rejects(
      () =>
        createCategoryConfirmed({
          name: 'Net',
          color: '#2563eb',
          icon: 'star',
          id: 'cat_net',
        }),
      (error: unknown) => error instanceof CatalogSyncAmbiguousError,
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE ambiguous recovers when library-state already has the id', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let stateReads = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      throw new TypeError('Failed to fetch')
    }
    if (url.includes('/api/me/library-state')) {
      stateReads += 1
      // Preflight: missing. After lost transport: server already has the row.
      if (stateReads === 1) {
        return emptyLibraryStateResponse()
      }
      return libraryStateWithCategory({ id: 'cat_net', name: 'Net' })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const created = await createCategoryConfirmed({
      name: 'Net',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_net',
    })
    assert.equal(created.id, 'cat_net')
    assert.equal(useCollectionStore.getState().categories.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE double-click shares one in-flight request', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let posts = 0
  let resolvePost!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      return emptyLibraryStateResponse()
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      posts += 1
      return gate
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const a = createCategoryConfirmed({
      name: 'Dup',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_dup',
    })
    const b = createCategoryConfirmed({
      name: 'Dup',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_dup',
    })
    resolvePost(new Response(null, { status: 204 }))
    const [ca, cb] = await Promise.all([a, b])
    assert.equal(posts, 1)
    assert.equal(ca.id, cb.id)
    assert.equal(useCollectionStore.getState().categories.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE stale session after POST does not merge for B', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolvePost!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    // Preflight library-state for stable id — empty before POST.
    if (url.includes('/api/me/library-state')) {
      return new Response(
        JSON.stringify({
          categories: [],
          tracks: [],
          categoryAssignments: [],
          history: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Stale',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_stale',
    })
    bindAuthSessionEpoch('user-b')
    useCollectionStore.getState().clearUserLibrary()
    resolvePost(new Response(null, { status: 204 }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE lost HTTP then retry 409 reconciles same id as success', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let posts = 0
  let stateReads = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      stateReads += 1
      // 1: preflight first attempt (missing)
      // 2: after lost transport (still unknown / empty → ambiguous)
      // 3: preflight retry (still missing → POST)
      // 4: after 409 reconcile (found)
      if (stateReads >= 4) {
        return libraryStateWithCategory({ id: 'cat_lost', name: 'Lost' })
      }
      return emptyLibraryStateResponse()
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      posts += 1
      if (posts === 1) {
        throw new TypeError('Failed to fetch')
      }
      return new Response(JSON.stringify({ error: 'CATEGORY_EXISTS' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    await assert.rejects(
      () =>
        createCategoryConfirmed({
          name: 'Lost',
          color: '#2563eb',
          icon: 'star',
          id: 'cat_lost',
        }),
      (error: unknown) =>
        error instanceof CatalogSyncAmbiguousError &&
        error.catalogId === 'cat_lost',
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)

    const created = await createCategoryConfirmed({
      name: 'Lost',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_lost',
    })
    assert.equal(created.id, 'cat_lost')
    assert.equal(posts, 2)
    assert.equal(useCollectionStore.getState().categories.length, 1)
    assert.equal(useCollectionStore.getState().categories[0]?.id, 'cat_lost')
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE 409 with unavailable reconcile stays ambiguous without local merge', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      throw new TypeError('Failed to fetch')
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(JSON.stringify({ error: 'CATEGORY_EXISTS' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    await assert.rejects(
      () =>
        createCategoryConfirmed({
          name: 'Conflict',
          color: '#2563eb',
          icon: 'star',
          id: 'cat_conflict',
        }),
      (error: unknown) =>
        error instanceof CatalogSyncAmbiguousError &&
        error.catalogId === 'cat_conflict',
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE 409 reconcile missing id is not false success', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      return emptyLibraryStateResponse()
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(JSON.stringify({ error: 'CATEGORY_EXISTS' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    await assert.rejects(
      () =>
        createCategoryConfirmed({
          name: 'Ghost',
          color: '#2563eb',
          icon: 'star',
          id: 'cat_ghost',
        }),
      CatalogSyncAmbiguousError,
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE preflight finds existing id without second POST', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let posts = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      return libraryStateWithCategory({ id: 'cat_pre', name: 'Pre' })
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      posts += 1
      return new Response(null, { status: 204 })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const created = await createCategoryConfirmed({
      name: 'Pre',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_pre',
    })
    assert.equal(created.id, 'cat_pre')
    assert.equal(posts, 0)
    assert.equal(useCollectionStore.getState().categories.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('CREATE account switch during 409 reconcile does not merge for B', async () => {
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolveState!: (value: Response) => void
  const stateGate = new Promise<Response>((resolve) => {
    resolveState = resolve
  })
  let stateCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/library-state')) {
      stateCalls += 1
      if (stateCalls === 1) {
        return emptyLibraryStateResponse()
      }
      return stateGate
    }
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return new Response(JSON.stringify({ error: 'CATEGORY_EXISTS' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Switch',
      color: '#2563eb',
      icon: 'star',
      id: 'cat_switch',
    })
    for (let i = 0; i < 20 && stateCalls < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(stateCalls, 2)
    bindAuthSessionEpoch('user-b')
    useCollectionStore.getState().clearUserLibrary()
    resolveState(libraryStateWithCategory({ id: 'cat_switch', name: 'Switch' }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('RENAME success updates Zustand only after PATCH', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Старое' })
  const originalFetch = globalThis.fetch
  let resolvePatch!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePatch = resolve
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/me/categories/cat_a') && init?.method === 'PATCH') {
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const pending = updateCategoryConfirmed('cat_a', { name: 'Новое' })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(
      useCollectionStore.getState().categories.find((row) => row.id === 'cat_a')?.name,
      'Старое',
    )
    resolvePatch(new Response(null, { status: 204 }))
    const updated = await pending
    assert.equal(updated.name, 'Новое')
    assert.equal(
      useCollectionStore.getState().categories.find((row) => row.id === 'cat_a')?.name,
      'Новое',
    )
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('RENAME 500 keeps previous name', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Старое' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'SERVER' }), { status: 500 })) as typeof fetch
  try {
    await assert.rejects(
      () => updateCategoryConfirmed('cat_a', { name: 'Новое' }),
      (error: unknown) => error instanceof LibraryHttpError && error.status === 500,
    )
    assert.equal(
      useCollectionStore.getState().categories.find((row) => row.id === 'cat_a')?.name,
      'Старое',
    )
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('RENAME double-click shares one PATCH', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Старое' })
  const originalFetch = globalThis.fetch
  let patches = 0
  let resolvePatch!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePatch = resolve
  })
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches += 1
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const a = updateCategoryConfirmed('cat_a', { name: 'Новое' })
    const b = updateCategoryConfirmed('cat_a', { name: 'Новое' })
    resolvePatch(new Response(null, { status: 204 }))
    await Promise.all([a, b])
    assert.equal(patches, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('RENAME account switch mid-flight does not apply for B', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Старое' })
  const originalFetch = globalThis.fetch
  let resolvePatch!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolvePatch = resolve
  })
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const pending = updateCategoryConfirmed('cat_a', { name: 'Новое' })
    bindAuthSessionEpoch('user-b')
    useCollectionStore.getState().clearUserLibrary()
    resolvePatch(new Response(null, { status: 204 }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('DELETE success removes local membership only after 204', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Удалить' })
  seedMembership('cat_a', 'can_1')
  const originalFetch = globalThis.fetch
  let resolveDelete!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolveDelete = resolve
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/me/categories/cat_a') && init?.method === 'DELETE') {
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const pending = deleteCategoryConfirmed('cat_a')
    await new Promise((r) => setTimeout(r, 10))
    assert.ok(useCollectionStore.getState().categories.some((row) => row.id === 'cat_a'))
    assert.deepEqual(
      useCanonicalLibraryStore.getState().itemsById.can_1?.catalogIds,
      ['cat_a'],
    )
    resolveDelete(new Response(null, { status: 204 }))
    await pending
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === 'cat_a'),
      false,
    )
    assert.deepEqual(
      useCanonicalLibraryStore.getState().itemsById.can_1?.catalogIds,
      [],
    )
    assert.ok(useCanonicalLibraryStore.getState().itemsById.can_1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('DELETE 500 keeps catalog and membership', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'Keep' })
  seedMembership('cat_a', 'can_1')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'SERVER' }), { status: 500 })) as typeof fetch
  try {
    await assert.rejects(
      () => deleteCategoryConfirmed('cat_a'),
      (error: unknown) => error instanceof LibraryHttpError && error.status === 500,
    )
    assert.ok(useCollectionStore.getState().categories.some((row) => row.id === 'cat_a'))
    assert.deepEqual(
      useCanonicalLibraryStore.getState().itemsById.can_1?.catalogIds,
      ['cat_a'],
    )
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('DELETE double-click shares one request', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'DupDel' })
  const originalFetch = globalThis.fetch
  let deletes = 0
  let resolveDelete!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolveDelete = resolve
  })
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deletes += 1
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const a = deleteCategoryConfirmed('cat_a')
    const b = deleteCategoryConfirmed('cat_a')
    resolveDelete(new Response(null, { status: 204 }))
    await Promise.all([a, b])
    assert.equal(deletes, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('DELETE stale session does not drop local catalog for B', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'A' })
  const originalFetch = globalThis.fetch
  let resolveDelete!: (value: Response) => void
  const gate = new Promise<Response>((resolve) => {
    resolveDelete = resolve
  })
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return gate
    }
    throw new Error('unexpected')
  }) as typeof fetch

  try {
    const pending = deleteCategoryConfirmed('cat_a')
    // Как logout/login: очистка библиотеки A и hydrate B.
    bindAuthSessionEpoch('user-b')
    useCollectionStore.getState().clearUserLibrary()
    seedCatalog({ id: 'cat_b', name: 'B' })
    resolveDelete(new Response(null, { status: 204 }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.deepEqual(
      useCollectionStore.getState().categories.map((row) => row.id),
      ['cat_b'],
    )
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('DELETE system catalog is rejected without request', async () => {
  resetSession('user-a')
  seedCatalog({ id: 'sys_swipes', name: 'Свайпы', system: true })
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    await assert.rejects(() => deleteCategoryConfirmed('sys_swipes'))
    assert.equal(called, false)
    assert.ok(useCollectionStore.getState().categories.some((row) => row.id === 'sys_swipes'))
  } finally {
    globalThis.fetch = originalFetch
    resetSession(null)
  }
})

test('applyCategoryDeletedLocally drops membership but keeps canonical item', () => {
  resetSession('user-a')
  seedCatalog({ id: 'cat_a', name: 'X' })
  seedMembership('cat_a', 'can_1')
  applyCategoryDeletedLocally('cat_a')
  assert.equal(useCollectionStore.getState().categories.length, 0)
  assert.ok(useCanonicalLibraryStore.getState().itemsById.can_1)
  assert.deepEqual(useCanonicalLibraryStore.getState().itemsById.can_1?.catalogIds, [])
  resetSession(null)
})

test('UI wiring uses confirmed catalog CRUD helpers', () => {
  const list = readFileSync(new URL('../../components/catalog/CatalogList.tsx', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('../../pages/CatalogDetail.tsx', import.meta.url), 'utf8')
  const picker = readFileSync(
    new URL('../../components/CategoryPickerSheet.tsx', import.meta.url),
    'utf8',
  )
  assert.match(list, /createCategoryConfirmed/)
  assert.match(list, /pendingCreateIdRef/)
  assert.equal(list.includes('useCollectionStore((state) => state.createCategory)'), false)
  assert.match(detail, /updateCategoryConfirmed/)
  assert.match(detail, /deleteCategoryConfirmed/)
  assert.equal(detail.includes('deleteCategory(catalog.id)'), false)
  assert.equal(detail.includes('updateCategory(catalog.id'), false)
  assert.match(picker, /pendingCreateIdRef/)
  assert.match(picker, /CatalogSyncAmbiguousError/)
  assert.match(picker, /id: pendingId/)
  assert.match(picker, /Результат не подтверждён/)
  assert.doesNotMatch(
    picker.split('CatalogSyncAmbiguousError')[1] ?? '',
    /Каталог не создан/,
  )
})
