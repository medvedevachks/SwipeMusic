import assert from 'node:assert/strict'
import test from 'node:test'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  applyCatalogLoopRepeat,
  applyCatalogLoopRepeatIfOwned,
  ensureCatalogRepeatPolicyWatcher,
  resetCatalogRepeatPolicyForTests,
  syncCatalogRepeatPolicy,
} from './catalogRepeatPolicy.ts'

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

function track(id: string) {
  return {
    id,
    sourceId: 'local-folder',
    externalId: id,
    title: id,
    artist: 'A',
  }
}

test('catalog loop forces Repeat ALL and restores previous on context switch', () => {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode('OFF')
  queue.setQueue([track('a'), track('b')], 0, {
    type: 'playlist',
    id: 'cat_party',
    title: 'Вечеринка',
  })
  ensureCatalogRepeatPolicyWatcher()
  applyCatalogLoopRepeat('cat_party')
  assert.equal(queue.getRepeatMode(), 'ALL')

  queue.setQueue([track('w')], 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(queue.getRepeatMode(), 'OFF')
})

test('manual Repeat change is not overwritten when leaving catalog', () => {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode('OFF')
  queue.setQueue([track('a')], 0, {
    type: 'playlist',
    id: 'cat_x',
    title: 'X',
  })
  applyCatalogLoopRepeat('cat_x')
  queue.setRepeatMode('ONE')
  syncCatalogRepeatPolicy({
    type: 'search-seed',
    query: 'q',
    seedTrackId: 'a',
  })
  assert.equal(queue.getRepeatMode(), 'ONE')
})

test('single-track catalog with Repeat ALL cycles via next fromEnded', () => {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setQueue([track('only')], 0, {
    type: 'playlist',
    id: 'cat_one',
    title: 'One',
  })
  applyCatalogLoopRepeat('cat_one')
  const again = queue.next({ fromEnded: true })
  assert.equal(again?.id, 'only')
  assert.equal(queue.getSnapshot().currentIndex, 0)
  assert.equal(queue.getRepeatMode(), 'ALL')
})

test('late applyCatalogLoopRepeatIfOwned skips when context already left catalog', () => {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode('OFF')
  queue.setQueue([track('a')], 0, {
    type: 'playlist',
    id: 'cat_late',
    title: 'Late',
  })
  applyCatalogLoopRepeat('cat_late')
  assert.equal(queue.getRepeatMode(), 'ALL')

  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'hit',
    seedTrackId: 'hit',
  })
  assert.equal(queue.getRepeatMode(), 'OFF')

  const applied = applyCatalogLoopRepeatIfOwned('cat_late')
  assert.equal(applied, false)
  assert.equal(queue.getRepeatMode(), 'OFF')
  assert.equal(queue.getSnapshot().context.type, 'search-seed')
})

test('applyCatalogLoopRepeatIfOwned keeps ALL only for matching playlist owner', () => {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode('ONE')
  queue.setQueue([track('a'), track('b')], 0, {
    type: 'playlist',
    id: 'cat_own',
    title: 'Own',
  })
  assert.equal(applyCatalogLoopRepeatIfOwned('cat_other'), false)
  assert.equal(queue.getRepeatMode(), 'ONE')
  assert.equal(applyCatalogLoopRepeatIfOwned('cat_own'), true)
  assert.equal(queue.getRepeatMode(), 'ALL')
})
