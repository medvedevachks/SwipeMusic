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
