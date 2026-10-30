/**
 * PLAYBACK-BUG-01 — Previous/Next при повторяющихся track ID.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
} from './PlaybackQueue.ts'
import type { Track } from '../../types/track.ts'

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
}

function track(id: string, title = id): Track {
  return {
    id,
    sourceId: 'local',
    externalId: id,
    title,
    artist: 'Art',
  }
}

describe('PLAYBACK-BUG-01 duplicate track ids', () => {
  it('consecutive duplicates: Previous returns to second occurrence, not first', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const dup = track('dup')
    queue.setQueue([{ ...dup }, { ...dup }, track('b')], 0)
    assert.equal(queue.getSnapshot().currentIndex, 0)

    queue.next() // dup#1
    assert.equal(queue.getSnapshot().currentIndex, 1)
    assert.deepEqual(queue.getSnapshot().historyRanks, [0, 1])

    queue.next() // b
    assert.equal(queue.current()?.id, 'b')

    queue.previous() // back to dup#1
    assert.equal(queue.getSnapshot().currentIndex, 1)
    assert.equal(queue.current()?.id, 'dup')

    queue.previous() // back to dup#0
    assert.equal(queue.getSnapshot().currentIndex, 0)
  })

  it('separated duplicates keep occurrence ranks through Previous/Next', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const same = track('same')
    queue.setQueue([same, track('mid'), { ...same }], 0)
    queue.next()
    queue.next()
    assert.equal(queue.getSnapshot().currentIndex, 2)
    assert.deepEqual(queue.getSnapshot().historyRanks, [0, 0, 1])

    queue.previous()
    assert.equal(queue.getSnapshot().currentIndex, 1)
    queue.previous()
    assert.equal(queue.getSnapshot().currentIndex, 0)

    queue.next()
    queue.next()
    assert.equal(queue.getSnapshot().currentIndex, 2)
  })

  it('export/import preserves historyRanks for duplicate queue', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const dup = track('dup')
    queue.setQueue([{ ...dup }, { ...dup }, track('b')], 0)
    queue.next()
    queue.next()
    queue.previous()
    assert.equal(queue.getSnapshot().currentIndex, 1)

    const exported = queue.exportSessionState()
    assert.deepEqual(exported.historyRanks, [0, 1, 0])

    const restored = new PlaybackQueue({ persistenceMode: 'session' })
    const result = restored.importSessionState(exported)
    assert.equal(result.ok, true)
    assert.equal(restored.getSnapshot().currentIndex, 1)
    assert.deepEqual(restored.getSnapshot().historyRanks, [0, 1, 0])

    restored.previous()
    assert.equal(restored.getSnapshot().currentIndex, 0)
    restored.next()
    assert.equal(restored.getSnapshot().currentIndex, 1)
  })

  it('Repeat ONE does not infinite-loop on duplicate ids', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const dup = track('dup')
    queue.setQueue([{ ...dup }, { ...dup }], 0)
    queue.setRepeatMode('ONE')
    const again = queue.next({ fromEnded: true })
    assert.equal(again?.id, 'dup')
    assert.equal(queue.getSnapshot().currentIndex, 0)
  })

  it('Shuffle ON previous through duplicates stays finite', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const dup = track('dup')
    queue.setQueue([{ ...dup }, track('x'), { ...dup }, track('y')], 0)
    queue.setShuffleMode('ON')
    const seen = new Set<number>()
    for (let i = 0; i < 8; i += 1) {
      queue.next()
      seen.add(queue.getSnapshot().currentIndex)
    }
    for (let i = 0; i < 12; i += 1) {
      const before = queue.getSnapshot().historyIndex
      queue.previous()
      const after = queue.getSnapshot().historyIndex
      assert.ok(after <= before || before <= 0)
    }
    assert.ok(seen.size >= 1)
  })

  it('legacy persist without historyRanks still restores', () => {
    installMemoryLocalStorage()
    const dup = track('dup')
    localStorage.setItem(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        items: [{ ...dup }, { ...dup }, track('b')],
        currentIndex: 1,
        playOrder: [0, 1, 2],
        playOrderIndex: 1,
        repeatMode: 'OFF',
        shuffleMode: 'OFF',
        history: ['dup', 'dup'],
        historyIndex: 1,
        context: { type: 'none' },
      }),
    )
    const queue = new PlaybackQueue({ persistenceMode: 'legacy' })
    assert.equal(queue.getSnapshot().currentIndex, 1)
    assert.deepEqual(queue.getSnapshot().historyRanks, [0, 0])
  })
})
