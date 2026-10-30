import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
  type PersistedPlaybackQueue,
} from './PlaybackQueue.ts'

function installMemoryLocalStorage(): Map<string, string> {
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
  return memory
}

installMemoryLocalStorage()

function track(id: string): Track {
  return {
    id,
    sourceId: 'yandex-music',
    externalId: id,
    title: id,
    artist: 'Artist',
  }
}

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

test('late expand keeps sorted current as anchor and appends B/C', () => {
  const queue = new PlaybackQueue()
  const a = track('a')
  const b = track('b')
  const c = track('c')
  queue.setQueue([a], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.removePreservingCurrentPlayback('a')
  assert.equal(queue.current()?.id, 'a')

  const ok = queue.replacePlaylistItemsPreservingPlayback([b, c], {
    type: 'playlist',
    id: 'sys_swipes',
  })
  assert.equal(ok, true)
  assert.equal(queue.current()?.id, 'a')
  assert.deepEqual(
    queue.getSnapshot().items.map((item) => item.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(queue.getPendingRemovalIds(), ['a'])
  assert.equal(queue.peekNext()?.id, 'b')

  assert.equal(queue.next()?.id, 'b')
  assert.deepEqual(
    queue.getSnapshot().items.map((item) => item.id),
    ['b', 'c'],
  )
  assert.equal(
    queue.getSnapshot().history.includes('a'),
    false,
  )
})

test('late expand rejects foreign context', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setQueue([track('seed')], 0, {
    type: 'search-seed',
    query: 'x',
    seedTrackId: 'seed',
  })
  const rejected = queue.replacePlaylistItemsPreservingPlayback(
    [track('b'), track('c')],
    { type: 'playlist', id: 'sys_swipes' },
  )
  assert.equal(rejected, false)
  assert.equal(queue.current()?.id, 'seed')
})

test('removePreservingCurrentPlayback keeps current playing until next', () => {
  const queue = new PlaybackQueue()
  const a = track('a')
  const b = track('b')
  const c = track('c')
  queue.setQueue([a, b, c], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ALL')

  queue.removePreservingCurrentPlayback('a')

  assert.equal(queue.current()?.id, 'a')
  assert.deepEqual(queue.getPendingRemovalIds(), ['a'])
  assert.equal(queue.peekNext()?.id, 'b')
  assert.equal(queue.getSnapshot().history.includes('a'), false)

  const next = queue.next()
  assert.equal(next?.id, 'b')
  assert.equal(queue.current()?.id, 'b')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'a'),
    false,
  )
  assert.deepEqual(queue.getPendingRemovalIds(), [])
})

test('sorted current is excluded from Repeat ALL restart', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ALL')
  queue.removePreservingCurrentPlayback('a')
  assert.equal(queue.next()?.id, 'b')
  assert.equal(queue.next()?.id, 'b')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'a'),
    false,
  )
})

test('Repeat ONE on sorted A advances to B instead of repeating A', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('b')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ONE')
  queue.removePreservingCurrentPlayback('a')
  assert.equal(queue.next({ fromEnded: true })?.id, 'b')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'a'),
    false,
  )
})

test('sorting last track does not clear mid-playback; next ends cleanly', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('solo')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.setRepeatMode('ALL')
  queue.removePreservingCurrentPlayback('solo')
  assert.equal(queue.current()?.id, 'solo')
  assert.equal(queue.next({ fromEnded: true }), null)
  assert.equal(queue.getSnapshot().items.length, 0)
})

test('pending removal round-trip purge ghosts after restore', async () => {
  const memory = installMemoryLocalStorage()
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('b'), track('c')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.removePreservingCurrentPlayback('a')
  await flushPersist()

  const saved = JSON.parse(
    memory.get(PLAYBACK_QUEUE_STORAGE_KEY)!,
  ) as PersistedPlaybackQueue
  assert.deepEqual(saved.pendingRemovalIds, ['a'])
  assert.equal(saved.items.some((item) => item.id === 'a'), true)

  const restored = new PlaybackQueue()
  assert.deepEqual(
    restored.getSnapshot().items.map((item) => item.id),
    ['b', 'c'],
  )
  assert.deepEqual(restored.getPendingRemovalIds(), [])
  assert.equal(restored.current()?.id, 'b')
  assert.equal(restored.getSnapshot().history.includes('a'), false)
})

test('classic remove of non-current still works without stopping current', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('b'), track('c')], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.remove('b')
  assert.equal(queue.current()?.id, 'a')
  assert.deepEqual(
    queue.getSnapshot().items.map((item) => item.id),
    ['a', 'c'],
  )
})

const PLAYLIST = {
  type: 'playlist' as const,
  id: 'cat_party',
  title: 'Вечеринка',
}

/** Math.random → 0 даёт identity playOrder после pin current в setShuffleMode. */
function enableDeterministicShuffle(queue: PlaybackQueue): void {
  const original = Math.random
  Math.random = () => 0
  try {
    queue.setShuffleMode('ON')
  } finally {
    Math.random = original
  }
}

function assertPlayOrderInvariant(queue: PlaybackQueue): void {
  const snap = queue.getSnapshot()
  const n = snap.items.length
  assert.equal(snap.playOrder.length, n)
  assert.deepEqual(
    [...snap.playOrder].sort((a, b) => a - b),
    Array.from({ length: n }, (_, index) => index),
  )
  assert.ok(snap.currentIndex >= 0 && snap.currentIndex < n)
  assert.equal(snap.playOrder.includes(snap.currentIndex), true)
  assert.equal(snap.playOrder[snap.playOrderIndex], snap.currentIndex)
}

test('Shuffle ON expand keeps planned Next (A→C→B + D → Next stays C)', () => {
  const queue = new PlaybackQueue()
  // items в порядке A,C,B → identity shuffle сохраняет A→C→B.
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  queue.setRepeatMode('ALL')
  assert.equal(queue.current()?.id, 'a')
  assert.equal(queue.peekNext()?.id, 'c')
  const historyBefore = queue.getSnapshot().history

  const ok = queue.replacePlaylistItemsPreservingPlayback(
    [track('a'), track('b'), track('c'), track('d')],
    { type: 'playlist', id: PLAYLIST.id },
  )
  assert.equal(ok, true)
  const snap = queue.getSnapshot()
  assert.equal(snap.shuffleMode, 'ON')
  assert.equal(snap.repeatMode, 'ALL')
  assert.equal(queue.current()?.id, 'a')
  assert.equal(queue.peekNext()?.id, 'c')
  assert.deepEqual(snap.history, historyBefore)
  // Дальше: C, B, затем новый D.
  assert.equal(queue.next()?.id, 'c')
  assert.equal(queue.next()?.id, 'b')
  assert.equal(queue.next()?.id, 'd')
})

test('Shuffle ON expand is idempotent for the same track set', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  const incoming = [track('a'), track('b'), track('c'), track('d')]
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(incoming, {
      type: 'playlist',
      id: PLAYLIST.id,
    }),
    true,
  )
  const first = queue.getSnapshot()
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(incoming, {
      type: 'playlist',
      id: PLAYLIST.id,
    }),
    true,
  )
  const second = queue.getSnapshot()
  assert.deepEqual(
    second.playOrder.map((index) => second.items[index]?.id),
    first.playOrder.map((index) => first.items[index]?.id),
  )
  assert.equal(second.currentIndex, first.currentIndex)
  assert.equal(second.playOrderIndex, first.playOrderIndex)
})

test('Shuffle ON expand drops removed catalog tracks from future order', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  assert.equal(queue.peekNext()?.id, 'c')
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b'), track('d')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  assert.equal(queue.current()?.id, 'a')
  // C убран из каталога — Next больше не C.
  assert.equal(queue.peekNext()?.id, 'b')
  assert.equal(queue.next()?.id, 'b')
  assert.equal(queue.next()?.id, 'd')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'c'),
    false,
  )
})

test('Shuffle ON expand after Next/Previous keeps current and history cursor', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  assert.equal(queue.next()?.id, 'c')
  assert.equal(queue.previous()?.id, 'a')
  assert.equal(queue.next()?.id, 'c')
  const before = queue.getSnapshot()
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b'), track('c'), track('d')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  const after = queue.getSnapshot()
  assert.equal(queue.current()?.id, 'c')
  assert.deepEqual(after.history, before.history)
  assert.equal(after.historyIndex, before.historyIndex)
  assert.equal(queue.peekNext()?.id, 'b')
})

test('Shuffle OFF expand still follows catalog item order', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('b'), track('c')], 1, PLAYLIST)
  assert.equal(queue.current()?.id, 'b')
  assert.equal(queue.getSnapshot().shuffleMode, 'OFF')
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b'), track('c'), track('d')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  assert.equal(queue.current()?.id, 'b')
  assert.equal(queue.peekNext()?.id, 'c')
  assert.equal(queue.getSnapshot().shuffleMode, 'OFF')
})

test('Shuffle ON expand ignores foreign playlist / search / wave context', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'hit',
    seedTrackId: 'hit',
  })
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b'), track('c')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    false,
  )
  assert.equal(queue.current()?.id, 'hit')

  queue.setQueue([track('wave')], 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    false,
  )
  assert.equal(queue.current()?.id, 'wave')
})

test('Shuffle ON expand keeps Repeat ONE and removed current as pending anchor', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  queue.setRepeatMode('ONE')
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback([track('c'), track('b')], {
      type: 'playlist',
      id: PLAYLIST.id,
    }),
    true,
  )
  assert.equal(queue.current()?.id, 'a')
  assert.deepEqual(queue.getPendingRemovalIds(), ['a'])
  assert.equal(queue.getSnapshot().repeatMode, 'ONE')
  assert.equal(queue.peekNext()?.id, 'c')
})

test('Shuffle ON expand appends 100+ new tracks after planned tail', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  const extras = Array.from({ length: 120 }, (_, index) =>
    track(`n${index}`),
  )
  const incoming = [track('a'), track('b'), track('c'), ...extras]
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(incoming, {
      type: 'playlist',
      id: PLAYLIST.id,
    }),
    true,
  )
  assertPlayOrderInvariant(queue)
  assert.equal(queue.current()?.id, 'a')
  assert.equal(queue.next()?.id, 'c')
  assert.equal(queue.next()?.id, 'b')
  assert.equal(queue.next()?.id, 'n0')
  assert.equal(queue.getSnapshot().items.length, 123)
})

test('Shuffle ON expand with duplicate Track.id keeps playOrder permutation', () => {
  const queue = new PlaybackQueue()
  // items=[A,B,B] — до фикса playOrder терял один индекс B.
  queue.setQueue([track('A'), track('B'), track('B')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  assertPlayOrderInvariant(queue)
  assert.equal(queue.current()?.id, 'A')
  assert.equal(queue.peekNext()?.id, 'B')

  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('A'), track('B'), track('B'), track('D')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  assertPlayOrderInvariant(queue)
  assert.equal(queue.current()?.id, 'A')
  assert.equal(queue.peekNext()?.id, 'B')
  assert.equal(queue.next()?.id, 'B')
  assert.equal(queue.next()?.id, 'B')
  assert.equal(queue.next()?.id, 'D')
  assert.equal(queue.previous()?.id, 'B')
  assertPlayOrderInvariant(queue)
})

test('Shuffle ON expand anchors duplicate current by occurrence rank', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('A'), track('B'), track('B')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  assert.equal(queue.next()?.id, 'B')
  assert.equal(queue.next()?.id, 'B')
  // current = второе B (index 2)
  assert.equal(queue.getSnapshot().currentIndex, 2)
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('A'), track('B'), track('B'), track('D')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  assertPlayOrderInvariant(queue)
  assert.equal(queue.current()?.id, 'B')
  assert.equal(queue.getSnapshot().currentIndex, 2)
  assert.equal(queue.peekNext()?.id, 'D')
})

test('unique-id Shuffle expand still preserves planned Next after duplicate fix', () => {
  const queue = new PlaybackQueue()
  queue.setQueue([track('a'), track('c'), track('b')], 0, PLAYLIST)
  enableDeterministicShuffle(queue)
  assert.equal(
    queue.replacePlaylistItemsPreservingPlayback(
      [track('a'), track('b'), track('c'), track('d')],
      { type: 'playlist', id: PLAYLIST.id },
    ),
    true,
  )
  assertPlayOrderInvariant(queue)
  assert.equal(queue.current()?.id, 'a')
  assert.equal(queue.peekNext()?.id, 'c')
})
