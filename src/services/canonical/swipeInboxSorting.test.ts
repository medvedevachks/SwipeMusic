import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { isRecommendationAdvanceContext } from '../recommendation/advance.ts'
import {
  getRecommendationSessionMode,
  resetRecommendationSessionRuntimeForTests,
} from '../recommendation/sessionRuntime.ts'
import { resetRecommendationSessionStateForTests } from '../recommendation/sessionState.ts'
import { classifySwipeTrack } from '../swipeClassification/classifySwipeTrack.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { removeSortedCanonicalFromSwipesQueue } from './swipeInboxQueue.ts'
import {
  buildSwipeInboxPlaybackTracks,
  resetSwipeInboxPlayGenerationForTests,
  startSwipeInboxSorting,
} from './swipeInboxSorting.ts'

const NOW = '2026-10-30T00:00:00.000Z'

function installMemoryLocalStorage(): void {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
}

function item(
  id: string,
  title: string,
  catalogIds: string[] = [SYS_SWIPES_ID],
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id,
      title,
      artist: 'Artist',
      album: null,
      durationMs: 180_000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      {
        sourceTrackKey: `yandex-music:${id}`,
        canonicalTrackId: id,
        sourceId: 'yandex-music',
        externalId: id,
        title,
        artist: 'Artist',
        album: null,
        durationMs: 180_000,
        artworkUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    state: {
      addedAt: NOW,
      lastPlayed: null,
      playCount: 0,
      liked: true,
      likedAt: NOW,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
    catalogIds,
  }
}

test('buildSwipeInboxPlaybackTracks skips empty copies and non-inbox', () => {
  const built = buildSwipeInboxPlaybackTracks([
    item('can_a', 'A'),
    item('can_out', 'Out', ['cat_party']),
  ])
  assert.deepEqual(
    built.tracks.map((track) => track.id),
    ['yandex-music:can_a'],
  )
  assert.deepEqual(built.canonicalIds, ['can_a'])
})

test('startSwipeInboxSorting plays chosen track and sets sys_swipes playlist queue', async () => {
  installMemoryLocalStorage()
  resetRecommendationSessionRuntimeForTests()
  resetRecommendationSessionStateForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  const played: string[] = []
  const items = [item('can_a', 'A'), item('can_b', 'B'), item('can_c', 'C')]
  const result = await startSwipeInboxSorting({
    items,
    startCanonicalTrackId: 'can_b',
    playTrack: async (track: Track) => {
      played.push(track.id)
    },
  })
  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.equal(result.startIndex, 1)
  assert.deepEqual(played, ['yandex-music:can_b'])
  assert.equal(queue.getPlaybackContext().type, 'playlist')
  assert.equal(
    queue.getPlaybackContext().type === 'playlist'
      ? queue.getPlaybackContext().id
      : null,
    SYS_SWIPES_ID,
  )
  assert.equal(queue.current()?.id, 'yandex-music:can_b')
  assert.equal(isRecommendationAdvanceContext(queue.getPlaybackContext()), false)
  assert.equal(getRecommendationSessionMode(), null)
  assert.equal(queue.next()?.id, 'yandex-music:can_c')
  queue.clear()
})

test('startSwipeInboxSorting empty inbox', async () => {
  const result = await startSwipeInboxSorting({
    items: [item('can_x', 'X', ['cat_party'])],
    playTrack: async () => undefined,
  })
  assert.equal(result.status, 'empty')
})

test('startSwipeInboxSorting resets leftover search deck mode', async () => {
  installMemoryLocalStorage()
  resetRecommendationSessionRuntimeForTests()
  resetRecommendationSessionStateForTests()
  getPlaybackQueue().clear()
  let resetCalls = 0
  const result = await startSwipeInboxSorting({
    items: [item('can_a', 'A'), item('can_b', 'B')],
    startCanonicalTrackId: 'can_a',
    playTrack: async () => undefined,
    resetDeckSession: () => {
      resetCalls += 1
    },
  })
  assert.equal(result.status, 'played')
  assert.equal(resetCalls, 1)
  getPlaybackQueue().clear()
})

test('startSwipeInboxSorting unavailable preferred without playable copy', async () => {
  const bare = item('can_bare', 'Bare')
  bare.copies = []
  const result = await startSwipeInboxSorting({
    items: [bare],
    startCanonicalTrackId: 'can_bare',
    playTrack: async () => {
      throw new Error('should not play')
    },
  })
  assert.equal(result.status, 'empty')
})

test('startSwipeInboxSorting play failure is error not fake audible success', async () => {
  installMemoryLocalStorage()
  resetRecommendationSessionRuntimeForTests()
  resetRecommendationSessionStateForTests()
  resetSwipeInboxPlayGenerationForTests()
  getPlaybackQueue().clear()
  const result = await startSwipeInboxSorting({
    items: [item('can_a', 'A')],
    playTrack: async () => {
      throw new Error('Track unavailable')
    },
  })
  assert.equal(result.status, 'error')
  if (result.status === 'error') {
    assert.match(result.message, /unavailable|Не удалось/i)
  }
  getPlaybackQueue().clear()
})

test('stale inbox Play does not replace queue after newer launch', async () => {
  installMemoryLocalStorage()
  resetRecommendationSessionRuntimeForTests()
  resetRecommendationSessionStateForTests()
  resetSwipeInboxPlayGenerationForTests()
  getPlaybackQueue().clear()

  let releaseSlowReset!: () => void
  const slowReset = new Promise<void>((resolve) => {
    releaseSlowReset = resolve
  })
  let firstPlayCalls = 0

  const first = startSwipeInboxSorting({
    items: [item('can_a', 'A'), item('can_b', 'B')],
    startCanonicalTrackId: 'can_a',
    resetDeckSession: async () => {
      await slowReset
    },
    playTrack: async () => {
      firstPlayCalls += 1
    },
  })

  // Дать первому вызову дойти до await resetDeckSession (после setQueue A).
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(getPlaybackQueue().current()?.id, 'yandex-music:can_a')

  const second = await startSwipeInboxSorting({
    items: [item('can_a', 'A'), item('can_b', 'B')],
    startCanonicalTrackId: 'can_b',
    playTrack: async () => undefined,
  })
  assert.equal(second.status, 'played')
  assert.equal(getPlaybackQueue().current()?.id, 'yandex-music:can_b')

  releaseSlowReset()
  const firstResult = await first
  assert.equal(firstResult.status, 'error')
  assert.equal(firstPlayCalls, 0)
  assert.equal(getPlaybackQueue().current()?.id, 'yandex-music:can_b')
  getPlaybackQueue().clear()
})

test('inbox sort: LIKE then UP then categorize removes from queue without stopping current', async () => {
  installMemoryLocalStorage()
  resetRecommendationSessionRuntimeForTests()
  resetRecommendationSessionStateForTests()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  const a = item('can_a', 'A')
  const b = item('can_b', 'B')
  useCanonicalLibraryStore.getState().replaceForUser('u1', [a, b])
  const queue = getPlaybackQueue()
  queue.clear()
  const result = await startSwipeInboxSorting({
    items: [a, b],
    startCanonicalTrackId: 'can_a',
    playTrack: async () => undefined,
  })
  assert.equal(result.status, 'played')
  const trackA = queue.current()!
  assert.equal(trackA.id, 'yandex-music:can_a')

  classifySwipeTrack(trackA, 'skip')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    false,
  )
  assert.equal(queue.current()?.id, 'yandex-music:can_a')

  assert.equal(queue.next()?.id, 'yandex-music:can_b')
  assert.equal(queue.current()?.id, 'yandex-music:can_b')

  // Simulate successful catalog assign + inbox unassign in store.
  useCanonicalLibraryStore.getState().replaceForUser('u1', [
    { ...a, catalogIds: ['cat_party'] },
    b,
  ])
  removeSortedCanonicalFromSwipesQueue('can_a')
  assert.equal(queue.current()?.id, 'yandex-music:can_b')
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'yandex-music:can_a'),
    false,
  )
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})
