import assert from 'node:assert/strict'
import test from 'node:test'
import { useCollectionStore } from '../../store/collectionStore.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
  StaleLibrarySessionError,
} from '../auth/sessionEpoch.ts'
import { createCategoryConfirmed } from './createCategoryConfirmed.ts'

function resetSession(userId: string | null = 'user-a'): void {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch(userId)
}

test('createCategoryConfirmed awaits server POST before returning and local merge', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolvePost!: (value: Response) => void
  const postGate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })
  let postStarted = false
  let assignStarted = false

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      postStarted = true
      return postGate
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Отпуск',
      color: '#2563eb',
      icon: 'star',
    })
    const sequenced = pending.then(async (category) => {
      assert.equal(postStarted, true)
      assert.equal(
        useCollectionStore.getState().categories.some((row) => row.id === category.id),
        true,
      )
      assignStarted = true
      return category
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(postStarted, true)
    assert.equal(assignStarted, false)
    assert.equal(useCollectionStore.getState().categories.length, 0)

    resolvePost(new Response(null, { status: 204 }))
    const created = await sequenced
    assert.equal(created.name, 'Отпуск')
    assert.equal(assignStarted, true)
    assert.equal(
      useCollectionStore.getState().categories.some((row) => row.id === created.id),
      true,
    )
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})

test('slow POST without account switch still merges locally', async () => {
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
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Медленный',
      color: '#2563eb',
      icon: 'star',
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(useCollectionStore.getState().categories.length, 0)
    resolvePost(new Response(null, { status: 204 }))
    const created = await pending
    assert.equal(created.name, 'Медленный')
    assert.equal(useCollectionStore.getState().categories.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})

test('POST started as A then finished after B login does not merge or assign', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  let resolvePost!: (value: Response) => void
  const postGate = new Promise<Response>((resolve) => {
    resolvePost = resolve
  })
  let assignStarted = false

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/me/categories') && init?.method === 'POST') {
      return postGate
    }
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'От A',
      color: '#2563eb',
      icon: 'star',
    })
    const guarded = pending.then(
      (category) => {
        assignStarted = true
        return category
      },
      (error: unknown) => {
        assert.ok(error instanceof StaleLibrarySessionError)
        return null
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 10))
    bindAuthSessionEpoch('user-b')
    resolvePost(new Response(null, { status: 204 }))
    const result = await guarded
    assert.equal(result, null)
    assert.equal(assignStarted, false)
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})

test('logout during create does not merge category for next session', async () => {
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
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'После logout',
      color: '#2563eb',
      icon: 'star',
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    bindAuthSessionEpoch(null)
    resolvePost(new Response(null, { status: 204 }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.equal(useCollectionStore.getState().categories.length, 0)

    bindAuthSessionEpoch('user-a')
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})

test('same userId re-login uses new session generation and rejects stale create', async () => {
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
    throw new Error(`unexpected ${url}`)
  }) as typeof fetch

  try {
    const pending = createCategoryConfirmed({
      name: 'Поколение',
      color: '#2563eb',
      icon: 'star',
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    bindAuthSessionEpoch('user-a')
    resolvePost(new Response(null, { status: 204 }))
    await assert.rejects(() => pending, StaleLibrarySessionError)
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})

test('failed create does not leave a local category', async () => {
  useCollectionStore.getState().clearUserLibrary()
  resetSession('user-a')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(null, { status: 500 })) as typeof fetch
  try {
    await assert.rejects(() =>
      createCategoryConfirmed({
        name: 'Отпуск',
        color: '#2563eb',
        icon: 'star',
      }),
    )
    assert.equal(useCollectionStore.getState().categories.length, 0)
  } finally {
    globalThis.fetch = originalFetch
    useCollectionStore.getState().clearUserLibrary()
    resetAuthSessionEpochForTests()
  }
})
