/**
 * PLAYBACK-DEV-08 — SWIPES / WAVE SessionSwitch + CME ownership isolation.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  createPlaybackSessionStore,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { createPlaybackSessionPersistence } from '../../playbackSession/persistence.ts'
import { getPlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import {
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
} from '../featureFlag.ts'
import { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
import { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
import {
  isCmeLiveMutationAllowed,
  resetCmeSessionOwnershipForTests,
} from './cmeSessionOwnership.ts'
import { playAlbumViaSessionSwitch } from './playAlbumSession.ts'
import { playCatalogViaSessionSwitch } from './playCatalogSession.ts'
import { playSearchViaSessionSwitch } from './playSearchSession.ts'
import { playSwipeViaSessionSwitch } from './playSwipeSession.ts'
import { playWaveViaSessionSwitch } from './playWaveSession.ts'
import { seedSwipeOrWaveSessionWithoutPlay } from './seedSwipeWaveWithoutPlay.ts'
import {
  getSessionSwitchAppRuntime,
  resetSessionSwitchAppRuntimeForTests,
  setSessionSwitchAppRuntime,
} from './sessionSwitchAppRuntime.ts'
import { consumeRecommendationAdvance } from '../../recommendation/advance.ts'
import { getContinuationSession } from '../../continuation/ContinuationSession.ts'
import {
  activateRecommendationSession,
  clearRecommendationSession,
} from '../../recommendation/sessionRuntime.ts'

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
      clear: () => memory.clear(),
    },
  })
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

describe('PLAYBACK-DEV-08 SWIPES/WAVE + CME ownership', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    resetCmeSessionOwnershipForTests()
    clearRecommendationSession()
    const q = getPlaybackQueue()
    q.detachLegacyPersistence()
    q.clear()
  })

  afterEach(() => {
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    resetCmeSessionOwnershipForTests()
    clearRecommendationSession()
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
    return { store, live, adapter, runtime: getSessionSwitchAppRuntime()! }
  }

  it('flag OFF: swipe/wave session path отклонён', async () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    const s = await playSwipeViaSessionSwitch({ track: track('a') })
    const w = await playWaveViaSessionSwitch({ track: track('b') })
    assert.equal(s.ok, false)
    assert.equal(w.ok, false)
  })

  it('SWIPES → WAVE → SWIPES сохраняет слоты', async () => {
    const { store, live } = setupRuntime()
    await playSwipeViaSessionSwitch({ track: track('s1') })
    assert.equal(store.getActiveSessionId(), 'swipes')
    assert.equal(live.getPlaybackContext().type, 'swipe')
    live.next()
    // history grows only with queue ops that push — seed alone has hist 1

    await playWaveViaSessionSwitch({ track: track('w1') })
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.equal(live.getPlaybackContext().type, 'radio')
    assert.equal(store.getSlot('swipes').queue.items[0]?.id, 's1')

    await playSwipeViaSessionSwitch({ track: track('s2') })
    assert.equal(store.getActiveSessionId(), 'swipes')
    assert.equal(store.getSlot('wave').queue.items[0]?.id, 'w1')
    assert.equal(live.current()?.id, 's2')
  })

  it('WAVE → SEARCH → WAVE восстанавливает wave slot', async () => {
    const { store, live } = setupRuntime()
    await playWaveViaSessionSwitch({ track: track('w1') })
    const waveHist = [...store.getSlot('wave').queue.history]

    await playSearchViaSessionSwitch({
      track: track('q1'),
      query: 'q',
      searchHits: [track('q1')],
    })
    assert.equal(store.getActiveSessionId(), 'search')
    assert.deepEqual(store.getSlot('wave').queue.history, waveHist)

    await playWaveViaSessionSwitch({ track: track('w1') })
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.equal(live.getPlaybackContext().type, 'radio')
  })

  it('WAVE → CATALOG → WAVE и SWIPES → ALBUM → SWIPES', async () => {
    const { store } = setupRuntime()
    await playWaveViaSessionSwitch({ track: track('w1') })
    await playCatalogViaSessionSwitch({
      tracks: [track('c1')],
      startIndex: 0,
      catalogId: 'cat',
      catalogTitle: 'C',
    })
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.equal(isCmeLiveMutationAllowed(), false)
    assert.equal(store.getSlot('wave').queue.items[0]?.id, 'w1')

    await playWaveViaSessionSwitch({ track: track('w2') })
    assert.equal(store.getActiveSessionId(), 'wave')

    await playSwipeViaSessionSwitch({ track: track('s1') })
    await playAlbumViaSessionSwitch({
      tracks: [track('a1'), track('a2')],
      startIndex: 0,
      albumId: 'alb',
      albumTitle: 'A',
    })
    assert.equal(store.getActiveSessionId(), 'album')
    assert.equal(store.getSlot('swipes').queue.items[0]?.id, 's1')
    await playSwipeViaSessionSwitch({ track: track('s1') })
    assert.equal(store.getActiveSessionId(), 'swipes')
  })

  it('cold seed without play не вызывает adapter play', () => {
    const { store, live, adapter } = setupRuntime()
    const ok = seedSwipeOrWaveSessionWithoutPlay({
      mode: 'swipe',
      track: track('cold'),
    })
    assert.equal(ok.ok, true)
    assert.equal(store.getActiveSessionId(), 'swipes')
    assert.equal(live.current()?.id, 'cold')
    assert.equal(adapter.isPlaying(), false)
  })

  it('CME insertNext blocked after switch to CATALOG', async () => {
    const { live } = setupRuntime()
    await playSwipeViaSessionSwitch({ track: track('s1') })
    activateRecommendationSession('swipe', { forceProvider: true })
    assert.equal(isCmeLiveMutationAllowed(), true)

    await playCatalogViaSessionSwitch({
      tracks: [track('c1')],
      startIndex: 0,
      catalogId: 'cat',
      catalogTitle: 'C',
    })
    assert.equal(isCmeLiveMutationAllowed(), false)

    // Имитация stale CME: recommendation context + prepared, ownership сброшен.
    live.setQueue([track('c1')], 0, { type: 'swipe' })
    activateRecommendationSession('swipe', { forceProvider: true })
    getContinuationSession().prepare(track('evil'), {
      type: 'search-seed',
      query: 'swipe',
      seedTrackId: 'c1',
    })
    const inserted = consumeRecommendationAdvance(live, getContinuationSession(), {
      fromEnded: false,
    })
    assert.equal(inserted, null)
    assert.equal(
      live.getItems().some((t) => t.id === 'evil'),
      false,
    )
  })

  it('пять сессий: слоты не смешиваются при round-trip', async () => {
    const { store } = setupRuntime()
    await playSwipeViaSessionSwitch({ track: track('sw') })
    await playWaveViaSessionSwitch({ track: track('wv') })
    await playSearchViaSessionSwitch({
      track: track('sr'),
      query: 'q',
    })
    await playCatalogViaSessionSwitch({
      tracks: [track('ct')],
      startIndex: 0,
      catalogId: 'c',
      catalogTitle: 'C',
    })
    await playAlbumViaSessionSwitch({
      tracks: [track('al')],
      startIndex: 0,
      albumId: 'a',
      albumTitle: 'A',
    })
    assert.equal(store.getSlot('swipes').queue.items[0]?.id, 'sw')
    assert.equal(store.getSlot('wave').queue.items[0]?.id, 'wv')
    assert.equal(store.getSlot('search').queue.items[0]?.id, 'sr')
    assert.equal(store.getSlot('catalog').queue.items[0]?.id, 'ct')
    assert.equal(store.getSlot('album').queue.items[0]?.id, 'al')
    assert.equal(store.getActiveSessionId(), 'album')
  })
})
