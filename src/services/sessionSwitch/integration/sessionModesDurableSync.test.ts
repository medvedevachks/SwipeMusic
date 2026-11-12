/**
 * PLAYBACK-DEV-07 — durable sync + SEARCH/ALBUM session independence.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  createPlaybackSessionStore,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { createPlaybackSessionPersistence } from '../../playbackSession/persistence.ts'
import {
  PLAYBACK_QUEUE_STORAGE_KEY,
  getPlaybackQueue,
} from '../../playbackQueue/PlaybackQueue.ts'
import {
  isSessionSwitchIntegrationEnabled,
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
} from '../featureFlag.ts'
import { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
import { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
import {
  flushActiveSessionToStore,
  resetFlushRevisionForTests,
  bumpFlushRevision,
} from './flushActiveSession.ts'
import { releaseCatalogSessionForLegacyIntent } from './legacyQueueClaim.ts'
import { playAlbumViaSessionSwitch } from './playAlbumSession.ts'
import { playCatalogViaSessionSwitch } from './playCatalogSession.ts'
import { playSearchViaSessionSwitch } from './playSearchSession.ts'
import { restoreActiveSessionWithoutAutoplay } from './restoreActiveSession.ts'
import {
  getSessionSwitchAppRuntime,
  resetSessionSwitchAppRuntimeForTests,
  setSessionSwitchAppRuntime,
} from './sessionSwitchAppRuntime.ts'
import {
  startActiveSessionDurableSync,
  stopActiveSessionDurableSync,
} from './activeSessionDurableSync.ts'

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
      clear: () => memory.clear(),
    },
  })
  return memory
}

function track(id: string) {
  return {
    id,
    sourceId: 'local',
    externalId: id,
    title: `T ${id}`,
    artist: 'A',
  }
}

function urlFor(id: string) {
  return `https://cdn.test/${id}.mp3`
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('PLAYBACK-DEV-07 durable sync + SEARCH/ALBUM', () => {
  let memory: Map<string, string>

  beforeEach(() => {
    memory = installMemoryLocalStorage()
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    resetFlushRevisionForTests()
    stopActiveSessionDurableSync()
    const q = getPlaybackQueue()
    q.detachLegacyPersistence()
    q.clear()
  })

  afterEach(() => {
    stopActiveSessionDurableSync()
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    resetFlushRevisionForTests()
  })

  function setupRuntime() {
    setSessionSwitchIntegrationEnabledForTests(true)
    const store = createPlaybackSessionStore({
      userId: 'user-1',
      deviceId: 'device-1',
    })
    const live = getPlaybackQueue()
    live.detachLegacyPersistence()
    const adapter = createControllablePlayerAdapter()
    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: live,
      adapter,
      forceEnable: true,
      resolve: async (t) => ({
        url: urlFor(t.id),
        candidate: null,
      }),
    })
    assert.ok(runtime)
    const persistence = createPlaybackSessionPersistence({
      storage: globalThis.localStorage,
    })
    setSessionSwitchAppRuntime({
      ...runtime,
      store,
      persistence,
      userId: 'user-1',
      deviceId: 'device-1',
      bootstrapGeneration: 1,
    })
    return {
      store,
      live,
      adapter,
      runtime: getSessionSwitchAppRuntime()!,
      persistence,
    }
  }

  it('Next/Previous + Shuffle/Repeat flush into durable CATALOG before release', async () => {
    const { store, live } = setupRuntime()
    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b'), track('c')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    live.next()
    live.setShuffleMode('ON')
    live.setRepeatMode('ALL')
    bumpFlushRevision()
    const flushed = flushActiveSessionToStore({
      reason: 'queue',
      playing: true,
    })
    assert.equal(flushed.flushed, true)
    const durable = store.getSlot('catalog').queue
    assert.equal(durable.currentIndex, live.getSnapshot().currentIndex)
    assert.equal(durable.shuffleMode, 'ON')
    assert.equal(durable.repeatMode, 'ALL')
    assert.ok(durable.history.length >= 2)
  })

  it('flush не пишет search-seed в CATALOG (гонка switch)', async () => {
    const { store, live } = setupRuntime()
    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    live.next()
    flushActiveSessionToStore({ reason: 'queue', playing: true })
    const hist = [...store.getSlot('catalog').queue.history]
    // Имитация: live уже SEARCH, active ещё catalog.
    live.setQueue([track('s')], 0, {
      type: 'search-seed',
      query: 'q',
      seedTrackId: 's',
      hardExcludeHits: [],
    })
    const skipped = flushActiveSessionToStore({
      reason: 'queue',
      playing: true,
    })
    assert.equal(skipped.flushed, false)
    if (!skipped.flushed) {
      assert.equal(skipped.reason, 'context_mismatch')
    }
    assert.deepEqual(store.getSlot('catalog').queue.history, hist)
  })

  it('stale flush revision не перезаписывает более новый снимок', async () => {
    const { store, live } = setupRuntime()
    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    const stale = bumpFlushRevision()
    live.next()
    bumpFlushRevision()
    flushActiveSessionToStore({ reason: 'queue', playing: true })
    const afterFresh = store.getSlot('catalog').queue.currentIndex
    const staleResult = flushActiveSessionToStore({
      reason: 'queue',
      expectedRevision: stale,
      playing: true,
    })
    assert.equal(staleResult.flushed, false)
    if (!staleResult.flushed) {
      assert.equal(staleResult.reason, 'stale_revision')
    }
    assert.equal(store.getSlot('catalog').queue.currentIndex, afterFresh)
  })

  it('queue subscribe sync пишет durable после debounce', async () => {
    const { store, live, adapter } = setupRuntime()
    const fakePlayer = {
      subscribe: (listener: (s: { playing: boolean; currentTrack: { id: string } | null }) => void) => {
        listener({ playing: true, currentTrack: { id: 'a' } })
        return () => {}
      },
      getState: () => ({
        playing: adapter.isPlaying(),
        currentTrack: live.current(),
        currentTime: 0,
        paused: !adapter.isPlaying(),
      }),
      pause: () => adapter.pause(),
    }
    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    startActiveSessionDurableSync({
      queue: live,
      player: fakePlayer as never,
    })
    live.next()
    await wait(120)
    assert.equal(
      store.getSlot('catalog').queue.currentIndex,
      live.getSnapshot().currentIndex,
    )
    stopActiveSessionDurableSync()
  })

  it('restore без autoplay: трек в identity, active восстановлен', () => {
    const { store, live } = setupRuntime()
    store.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'c1', title: 'C' },
      queue: {
        ...store.getSlot('catalog').queue,
        items: [track('a'), track('b')].map((t) => ({
          id: t.id,
          sourceId: t.sourceId,
          externalId: t.externalId,
          title: t.title,
          artist: t.artist,
        })),
        currentIndex: 1,
        playOrder: [0, 1],
        playOrderIndex: 1,
        history: ['a', 'b'],
        historyIndex: 1,
        positionSeconds: 42,
        phase: 'user_paused',
        context: { type: 'playlist', id: 'c1', title: 'C' },
        sessionTailIds: [],
        updatedAt: new Date().toISOString(),
      },
    })
    let restoredTrackId: string | null = null
    let restoredPos = -1
    let played = false
    const result = restoreActiveSessionWithoutAutoplay({
      store,
      queue: live,
      player: {
        restorePausedIdentity(track, positionSeconds) {
          restoredTrackId = track?.id ?? null
          restoredPos = positionSeconds
        },
      },
      hydratedActiveSessionId: 'catalog',
    })
    assert.equal(result.restored, true)
    assert.equal(result.audioAutoplay, false)
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.equal(live.current()?.id, 'b')
    assert.equal(restoredTrackId, 'b')
    assert.equal(restoredPos, 42)
    assert.equal(played, false)
  })

  it('CATALOG → SEARCH → CATALOG сохраняет историю каталога', async () => {
    const { store, live } = setupRuntime()
    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b'), track('c')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    live.next()
    flushActiveSessionToStore({ reason: 'queue', playing: true })
    const catalogHistory = [...store.getSlot('catalog').queue.history]

    const search = await playSearchViaSessionSwitch({
      track: track('s1'),
      query: 'q',
      searchHits: [track('s1'), track('s2'), track('s3')],
    })
    assert.equal(search.ok, true)
    assert.equal(store.getActiveSessionId(), 'search')
    assert.equal(live.getItems().length, 1)
    assert.equal(live.getPlaybackContext().type, 'search-seed')
    const ctx = live.getPlaybackContext()
    assert.ok(ctx.type === 'search-seed' && ctx.hardExcludeHits.length >= 2)

    await playCatalogViaSessionSwitch({
      tracks: [track('a'), track('b'), track('c')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.deepEqual(store.getSlot('catalog').queue.history, catalogHistory)
  })

  it('SEARCH → ALBUM → SEARCH сохраняет search seed отдельно', async () => {
    const { store, live } = setupRuntime()
    await playSearchViaSessionSwitch({
      track: track('s1'),
      query: 'alpha',
      searchHits: [track('s1'), track('hit')],
    })
    assert.equal(store.getActiveSessionId(), 'search')
    const searchMeta = store.getSlot('search').meta

    await playAlbumViaSessionSwitch({
      tracks: [track('a1'), track('a2'), track('a3')],
      startIndex: 1,
      albumId: 'alb-1',
      albumTitle: 'Album',
      artist: 'Art',
    })
    assert.equal(store.getActiveSessionId(), 'album')
    assert.equal(live.current()?.id, 'a2')
    assert.equal(live.getPlaybackContext().type, 'album')
    const albumMeta = store.getSlot('album').meta
    assert.ok(albumMeta.kind === 'album' && albumMeta.albumId === 'alb-1')

    await playSearchViaSessionSwitch({
      track: track('s9'),
      query: 'beta',
      searchHits: [track('s9')],
    })
    assert.equal(store.getActiveSessionId(), 'search')
    // Предыдущий search meta/query сохранён до overwrite новым Play — слот заменён.
    assert.ok(store.getSlot('search').meta.kind === 'search')
    assert.equal(
      (store.getSlot('search').meta as { query: string | null }).query,
      'beta',
    )
    // Album слот не уничтожен.
    assert.ok(store.getSlot('album').meta.kind === 'album')
    assert.equal(
      (store.getSlot('album').meta as { albumId: string | null }).albumId,
      'alb-1',
    )
    void searchMeta
  })

  it('Prepare fail SEARCH не уничтожает CATALOG', async () => {
    setSessionSwitchIntegrationEnabledForTests(true)
    const store = createPlaybackSessionStore({
      userId: 'user-1',
      deviceId: 'device-1',
    })
    const live = getPlaybackQueue()
    live.detachLegacyPersistence()
    const adapter = createControllablePlayerAdapter()
    let resolveCalls = 0
    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: live,
      adapter,
      forceEnable: true,
      resolve: async (t) => {
        resolveCalls += 1
        if (t.id === 'bad') {
          return null
        }
        return { url: urlFor(t.id), candidate: null }
      },
    })
    assert.ok(runtime)
    setSessionSwitchAppRuntime({
      ...runtime,
      store,
      persistence: createPlaybackSessionPersistence({
        storage: globalThis.localStorage,
      }),
      userId: 'user-1',
      deviceId: 'device-1',
      bootstrapGeneration: 1,
    })

    await playCatalogViaSessionSwitch({
      tracks: [track('keep')],
      startIndex: 0,
      catalogId: 'c1',
      catalogTitle: 'C',
    })
    assert.equal(store.getActiveSessionId(), 'catalog')

    const failed = await playSearchViaSessionSwitch({
      track: track('bad'),
      query: 'q',
    })
    assert.equal(failed.ok, false)
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.equal(live.current()?.id, 'keep')
    assert.ok(resolveCalls >= 1)
  })

  it('flag OFF: search/album session path отклонён', async () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    const s = await playSearchViaSessionSwitch({
      track: track('s'),
      query: 'q',
    })
    const a = await playAlbumViaSessionSwitch({
      tracks: [track('a')],
      startIndex: 0,
      albumId: 'x',
      albumTitle: 'X',
    })
    assert.equal(s.ok, false)
    assert.equal(a.ok, false)
    if (!s.ok) assert.equal(s.reason, 'flag_off')
    if (!a.ok) assert.equal(a.reason, 'flag_off')
    assert.equal(isSessionSwitchIntegrationEnabled(), false)
  })

  it('legacy release сохраняет active SEARCH и не пишет legacy v1', async () => {
    const { store, live } = setupRuntime()
    await playSearchViaSessionSwitch({
      track: track('s1'),
      query: 'q',
      searchHits: [track('s1')],
    })
    live.setRepeatMode('ONE')
    const released = releaseCatalogSessionForLegacyIntent('swipe')
    assert.equal(released.released, true)
    assert.equal(released.savedSessionId, 'search')
    assert.equal(store.getActiveSessionId(), null)
    assert.equal(store.getSlot('search').queue.repeatMode, 'ONE')
    assert.equal(memory.has(PLAYBACK_QUEUE_STORAGE_KEY), false)
  })

  it('rapid Play SEARCH/ALBUM: побеждает последний', async () => {
    const { store, adapter } = setupRuntime()
    adapter.setLoadDelay(30)
    const p1 = playSearchViaSessionSwitch({
      track: track('s1'),
      query: 'one',
    })
    const p2 = playAlbumViaSessionSwitch({
      tracks: [track('a1')],
      startIndex: 0,
      albumId: 'alb',
      albumTitle: 'A',
    })
    adapter.setLoadDelay(0)
    const p3 = playSearchViaSessionSwitch({
      track: track('s2'),
      query: 'two',
    })
    await Promise.all([p1, p2, p3])
    assert.equal(store.getActiveSessionId(), 'search')
    assert.equal(
      (store.getSlot('search').meta as { seedTrackId: string | null })
        .seedTrackId,
      's2',
    )
  })
})
