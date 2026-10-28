import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { setSearchSeedPlaybackEnabled } from '../continuation/searchSeedPlayback.ts'
import {
  bindSessionTasteUser,
  invalidateSessionTasteProfile,
  loadSessionTasteProfile,
} from './loadSessionTasteProfile.ts'

const profile = {
  schemaVersion: 1,
  userId: 'user-a',
  builtAt: '2026-10-28T00:00:00.000Z',
  empty: false,
  tracks: [],
  catalogs: [],
  recentActivity: [],
}

test('session taste profile stays local to the signed-in response and the release switch', async () => {
  const radio = readFileSync(new URL('../personalRadio/radioSelection.ts', import.meta.url), 'utf8')
  const wave = readFileSync(new URL('../personalRadio/myWaveRuntime.ts', import.meta.url), 'utf8')
  assert.match(radio, /import\.meta\.env\?\.DEV !== true/)
  // Live wave path uses Recommendation Engine (not legacy selection === 'taste').
  assert.match(wave, /pickRecommendationStart/)
  assert.match(wave, /commitRecommendationSeed/)
  assert.match(wave, /mode: 'wave'/)
  const previous = globalThis.fetch
  const calls: string[] = []
  setSearchSeedPlaybackEnabled(false)
  invalidateSessionTasteProfile()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ profile }), { status: 200 })
  }) as typeof fetch
  try {
    assert.equal(await loadSessionTasteProfile(), null)
    assert.equal(calls.length, 0)
    setSearchSeedPlaybackEnabled(true)
    const first = await loadSessionTasteProfile()
    const second = await loadSessionTasteProfile()
    assert.equal(first?.userId, 'user-a')
    assert.equal(second?.userId, 'user-a')
    assert.deepEqual(calls, ['/api/me/taste-profile'])
    invalidateSessionTasteProfile()
    await loadSessionTasteProfile()
    assert.equal(calls.length, 2)
    assert.equal(calls.every((url) => !url.includes('userId=')), true)

    let status = 200
    globalThis.fetch = (async () =>
      new Response(status === 200 ? JSON.stringify({ profile }) : JSON.stringify({ error: 'UNAUTHENTICATED' }), {
        status,
      })) as typeof fetch
    invalidateSessionTasteProfile()
    assert.equal((await loadSessionTasteProfile())?.userId, 'user-a')
    status = 401
    invalidateSessionTasteProfile()
    assert.equal(await loadSessionTasteProfile(), null)
  } finally {
    setSearchSeedPlaybackEnabled(false)
    invalidateSessionTasteProfile()
    globalThis.fetch = previous
  }
})

function profileFor(userId: string) {
  return { ...profile, userId }
}

test('a late taste response from account A is dropped after the session becomes B', async () => {
  const previous = globalThis.fetch
  setSearchSeedPlaybackEnabled(true)
  bindSessionTasteUser('user-a')
  let releaseA: (response: Response) => void = () => {}
  const waitingA = new Promise<Response>((resolve) => {
    releaseA = resolve
  })
  let phase: 'a' | 'b' = 'a'
  globalThis.fetch = (async () => (phase === 'a' ? waitingA : Response.json({ profile: profileFor('user-b') }))) as typeof fetch
  try {
    const pendingA = loadSessionTasteProfile()
    bindSessionTasteUser('user-b')
    phase = 'b'
    const loadedB = await loadSessionTasteProfile()
    releaseA(Response.json({ profile: profileFor('user-a') }))
    assert.equal(await pendingA, null)
    assert.equal(loadedB?.userId, 'user-b')
    const again = await loadSessionTasteProfile()
    assert.equal(again?.userId, 'user-b')
  } finally {
    setSearchSeedPlaybackEnabled(false)
    bindSessionTasteUser(null)
    globalThis.fetch = previous
  }
})

test('taste profile errors do not throw and do not replace the current track owner', async () => {
  const previous = globalThis.fetch
  setSearchSeedPlaybackEnabled(true)
  bindSessionTasteUser('user-a')
  const statuses = [401, 429, 500]
  globalThis.fetch = (async () => new Response('{}', { status: statuses.shift() ?? 500 })) as typeof fetch
  try {
    for (const expected of [401, 429, 500]) {
      assert.equal(await loadSessionTasteProfile(), null)
      assert.equal(expected > 0, true)
    }
    globalThis.fetch = (async () => Response.json({ profile: { schemaVersion: 2, tracks: [] } })) as typeof fetch
    assert.equal(await loadSessionTasteProfile(), null)
    globalThis.fetch = (async () => Response.json({ profile: profileFor('user-b') })) as typeof fetch
    assert.equal(await loadSessionTasteProfile(), null)
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.ok(init?.signal)
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }) as typeof fetch
    assert.equal(await loadSessionTasteProfile(), null)
  } finally {
    setSearchSeedPlaybackEnabled(false)
    bindSessionTasteUser(null)
    globalThis.fetch = previous
  }
})
