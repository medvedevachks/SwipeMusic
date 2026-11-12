import assert from 'node:assert/strict'
import test from 'node:test'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem, SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import {
  bindAuthSessionEpoch,
  captureAuthSession,
  isAuthSessionCurrent,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  findQueueTrackIdForCanonical,
  removeSortedCanonicalFromSwipesQueue,
} from './swipeInboxQueue.ts'

const NOW = '2024-06-01T00:00:00.000Z'

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

function copy(
  sourceId: string,
  externalId: string,
  canonicalId: string,
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: canonicalId,
    sourceId,
    externalId,
    title: 'Город',
    artist: 'Север',
    album: null,
    durationMs: 180_000,
    artworkUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function item(
  canonicalId: string,
  externalId: string,
  catalogIds: string[] = ['sys_swipes'],
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id: canonicalId,
      title: `T-${canonicalId}`,
      artist: 'Север',
      album: null,
      durationMs: 180_000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      copy('spotify', `sp-${externalId}`, canonicalId),
      copy('yandex-music', `ya-${externalId}`, canonicalId),
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

function playing(externalId: string): Track {
  return {
    id: `yandex-music:ya-${externalId}`,
    sourceId: 'yandex-music',
    externalId: `ya-${externalId}`,
    title: `T-can_${externalId}`,
    artist: 'Север',
  }
}

/** Политика FullscreenPlayer после commitCatalogChoice (без UI). */
function applyFullscreenCatalogCommitResult(
  result: {
    status: 'ok' | 'partial' | 'failed'
    canonicalTrackId?: string | null
  },
  sessionAtStart: ReturnType<typeof captureAuthSession>,
): void {
  if (result.status === 'failed' || result.status === 'partial') {
    return
  }
  if (result.canonicalTrackId && isAuthSessionCurrent(sessionAtStart)) {
    removeSortedCanonicalFromSwipesQueue(result.canonicalTrackId)
  }
}

function resetAll(): void {
  installMemoryLocalStorage()
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  useCanonicalLibraryStore.getState().clear()
  getPlaybackQueue().clear()
}

test('queue removal matches playing SourceCopy, not preferred list copy', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item('can_x', '1')])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('1')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })

  assert.equal(findQueueTrackIdForCanonical('can_x'), 'yandex-music:ya-1')
  removeSortedCanonicalFromSwipesQueue('can_x')
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-1'])
  assert.equal(queue.current()?.id, 'yandex-music:ya-1')

  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'spotify:sp-1'),
    false,
  )
  useCanonicalLibraryStore.getState().clear()
  queue.clear()
})

test('foreign context is not modified', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item('can_x', '1')])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('1')], 0, {
    type: 'search-seed',
    query: 'x',
    seedTrackId: 'yandex-music:ya-1',
  })
  removeSortedCanonicalFromSwipesQueue('can_x')
  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.equal(queue.current()?.id, 'yandex-music:ya-1')
  useCanonicalLibraryStore.getState().clear()
  queue.clear()
})

test('Fullscreen success removes current from future inbox cycles without stopping sound', () => {
  resetAll()
  const a = item('can_a', 'a', ['sys_swipes', 'cat_party'])
  const b = item('can_b', 'b')
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [a, b])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })

  const session = captureAuthSession()
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    session,
  )

  assert.equal(queue.current()?.id, 'yandex-music:ya-a')
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-a'])
  assert.equal(queue.next()?.id, 'yandex-music:ya-b')
  assert.equal(queue.current()?.id, 'yandex-music:ya-b')
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'yandex-music:ya-a'),
    false,
  )
  // Membership / like remain in canonical store.
  assert.ok(useCanonicalLibraryStore.getState().itemsById.can_a?.state.liked)
  assert.deepEqual(useCanonicalLibraryStore.getState().itemsById.can_a?.catalogIds, [
    'sys_swipes',
    'cat_party',
  ])
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('Fullscreen failed and partial do not change the inbox queue', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  const session = captureAuthSession()

  applyFullscreenCatalogCommitResult({ status: 'failed' }, session)
  applyFullscreenCatalogCommitResult(
    { status: 'partial', canonicalTrackId: 'can_a' },
    session,
  )

  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.deepEqual(
    queue.getSnapshot().items.map((row) => row.id),
    ['yandex-music:ya-a', 'yandex-music:ya-b'],
  )
  assert.equal(queue.current()?.id, 'yandex-music:ya-a')
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('Repeat ALL after success does not bring sorted track back', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ALL')
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    captureAuthSession(),
  )

  assert.equal(queue.next()?.id, 'yandex-music:ya-b')
  assert.equal(queue.next()?.id, 'yandex-music:ya-b')
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'yandex-music:ya-a'),
    false,
  )
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('Repeat ONE does not re-loop a sorted current after it ends', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ONE')
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    captureAuthSession(),
  )

  // Pending removal: ended/next must leave the sorted track, not loop it.
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-a'])
  const afterEnd = queue.next({ fromEnded: true })
  assert.equal(afterEnd?.id, 'yandex-music:ya-b')
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'yandex-music:ya-a'),
    false,
  )
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('last sorted track leaves empty future queue while current still plays', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item('can_only', 'only')])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('only')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_only' },
    captureAuthSession(),
  )

  assert.equal(queue.current()?.id, 'yandex-music:ya-only')
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-only'])
  assert.equal(queue.next(), null)
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('wave / catalog / search contexts stay untouched', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item('can_x', '1')])
  const queue = getPlaybackQueue()
  const contexts = [
    {
      type: 'radio' as const,
      id: 'my-wave' as const,
      title: 'Моя волна',
      origin: 'recommendations' as const,
    },
    { type: 'playlist' as const, id: 'cat_user', title: 'Мой' },
    { type: 'album' as const, id: 'alb_1', title: 'Album' },
    {
      type: 'search-seed' as const,
      query: 'q',
      seedTrackId: 'yandex-music:ya-1',
    },
  ]

  for (const context of contexts) {
    queue.setQueue([playing('1')], 0, context)
    removeSortedCanonicalFromSwipesQueue('can_x')
    assert.deepEqual(queue.getPendingRemovalIds(), [])
    assert.equal(queue.current()?.id, 'yandex-music:ya-1')
  }
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('mode switch before stale success does not mutate the new queue', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  const session = captureAuthSession()

  // Пользователь ушёл в SEARCH, пока commit ещё шёл.
  queue.setQueue([playing('b')], 0, {
    type: 'search-seed',
    query: 'b',
    seedTrackId: 'yandex-music:ya-b',
  })
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    session,
  )

  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.deepEqual(
    queue.getSnapshot().items.map((row) => row.id),
    ['yandex-music:ya-b'],
  )
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('account switch before stale success does not mutate B queue', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  const sessionA = captureAuthSession()

  bindAuthSessionEpoch('user-b')
  useCanonicalLibraryStore.getState().replaceForUser('user-b', [item('can_b', 'b')])
  queue.setQueue([playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })

  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    sessionA,
  )

  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.deepEqual(
    queue.getSnapshot().items.map((row) => row.id),
    ['yandex-music:ya-b'],
  )
  resetAuthSessionEpochForTests()
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('repeated success on already-removed track does not damage queue', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  const session = captureAuthSession()
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    session,
  )
  assert.equal(queue.next()?.id, 'yandex-music:ya-b')

  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    session,
  )
  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.deepEqual(
    queue.getSnapshot().items.map((row) => row.id),
    ['yandex-music:ya-b'],
  )
  assert.equal(queue.current()?.id, 'yandex-music:ya-b')
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})

test('shuffle ON keeps future removal of sorted canonical', () => {
  resetAll()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', 'a'),
    item('can_b', 'b'),
    item('can_c', 'c'),
  ])
  const queue = getPlaybackQueue()
  queue.setQueue([playing('a'), playing('b'), playing('c')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setShuffleMode('ON')
  applyFullscreenCatalogCommitResult(
    { status: 'ok', canonicalTrackId: 'can_a' },
    captureAuthSession(),
  )

  assert.equal(queue.current()?.id, 'yandex-music:ya-a')
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-a'])
  const next = queue.next()
  assert.ok(next)
  assert.notEqual(next.id, 'yandex-music:ya-a')
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'yandex-music:ya-a'),
    false,
  )
  queue.clear()
  useCanonicalLibraryStore.getState().clear()
})
