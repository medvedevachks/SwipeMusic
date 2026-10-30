import assert from 'node:assert/strict'
import test from 'node:test'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  applyCatalogLoopRepeat,
  applyCatalogLoopRepeatIfOwned,
  ensureCatalogRepeatPolicyWatcher,
  noteUserRepeatModeChange,
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

function withCatalog(catalogId: string, mode: 'OFF' | 'ONE' | 'ALL') {
  installMemoryLocalStorage()
  resetCatalogRepeatPolicyForTests()
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode(mode)
  queue.setQueue([track('a'), track('b')], 0, {
    type: 'playlist',
    id: catalogId,
    title: 'Cat',
  })
  ensureCatalogRepeatPolicyWatcher()
  applyCatalogLoopRepeat(catalogId)
  assert.equal(queue.getRepeatMode(), 'ALL')
  return queue
}

test('Repeat OFF → catalog → search restores OFF', () => {
  const queue = withCatalog('cat_off', 'OFF')
  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'q',
    seedTrackId: 'hit',
  })
  assert.equal(queue.getRepeatMode(), 'OFF')
})

test('Repeat ONE → catalog → search restores ONE', () => {
  const queue = withCatalog('cat_one_prev', 'ONE')
  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'q',
    seedTrackId: 'hit',
  })
  assert.equal(queue.getRepeatMode(), 'ONE')
})

test('Repeat ALL → catalog → search restores ALL', () => {
  const queue = withCatalog('cat_all_prev', 'ALL')
  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'q',
    seedTrackId: 'hit',
  })
  assert.equal(queue.getRepeatMode(), 'ALL')
})

test('manual Repeat during catalog is kept on leave and blocks late ALL', () => {
  const queue = withCatalog('cat_manual', 'OFF')
  noteUserRepeatModeChange('ONE')
  queue.setRepeatMode('ONE')
  assert.equal(applyCatalogLoopRepeatIfOwned('cat_manual'), false)
  assert.equal(queue.getRepeatMode(), 'ONE')

  syncCatalogRepeatPolicy({
    type: 'search-seed',
    query: 'q',
    seedTrackId: 'a',
  })
  assert.equal(queue.getRepeatMode(), 'ONE')
})

test('queue.setRepeatMode away from ALL is treated as user override', () => {
  const queue = withCatalog('cat_watch', 'OFF')
  queue.setRepeatMode('OFF')
  assert.equal(applyCatalogLoopRepeatIfOwned('cat_watch'), false)
  queue.setQueue([track('w')], 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(queue.getRepeatMode(), 'OFF')
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
  const queue = withCatalog('cat_late', 'OFF')
  queue.setQueue([track('hit')], 0, {
    type: 'search-seed',
    query: 'hit',
    seedTrackId: 'hit',
  })
  assert.equal(queue.getRepeatMode(), 'OFF')
  assert.equal(applyCatalogLoopRepeatIfOwned('cat_late'), false)
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
