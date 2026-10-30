import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import { PlaybackQueue } from './PlaybackQueue.ts'

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
  assert.equal(
    queue.getSnapshot().history.includes('a'),
    false,
  )

  const next = queue.next()
  assert.equal(next?.id, 'b')
  assert.equal(queue.current()?.id, 'b')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'a'),
    false,
  )
  assert.deepEqual(queue.getPendingRemovalIds(), [])

  assert.equal(queue.previous()?.id, 'b')
  assert.equal(
    queue.getSnapshot().items.some((item) => item.id === 'a'),
    false,
  )
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

test('replacePlaylistItemsPreservingPlayback does not restore pending removals', () => {
  const queue = new PlaybackQueue()
  const a = track('a')
  const b = track('b')
  const c = track('c')
  queue.setQueue([a, b, c], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })
  queue.removePreservingCurrentPlayback('a')
  const ok = queue.replacePlaylistItemsPreservingPlayback([a, b, c], {
    type: 'playlist',
    id: 'sys_swipes',
  })
  assert.equal(ok, true)
  assert.equal(queue.current()?.id, 'a')
  assert.deepEqual(
    queue.getSnapshot().items.map((item) => item.id),
    ['a', 'b', 'c'],
  )
  // a remains only as playing pending; next skips to b and drops a
  assert.deepEqual(queue.getPendingRemovalIds(), ['a'])
  assert.equal(queue.next()?.id, 'b')
  assert.deepEqual(
    queue.getSnapshot().items.map((item) => item.id),
    ['b', 'c'],
  )
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
