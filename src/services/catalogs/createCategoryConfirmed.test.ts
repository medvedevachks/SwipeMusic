import assert from 'node:assert/strict'
import test from 'node:test'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { createCategoryConfirmed } from './createCategoryConfirmed.ts'

test('createCategoryConfirmed awaits server POST before returning and local merge', async () => {
  useCollectionStore.getState().clearUserLibrary()
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
    // Assign must not run until create resolves — simulate caller waiting.
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
  }
})

test('failed create does not leave a local category', async () => {
  useCollectionStore.getState().clearUserLibrary()
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
  }
})
