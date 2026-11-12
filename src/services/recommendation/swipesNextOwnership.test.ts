/**
 * PLAYBACK-FIX-01 — SWIPES Next: stale CME ownership + buffer loss → false exhausted.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ContinuationSession } from '../continuation/ContinuationSession.ts'
import { getContinuationSession } from '../continuation/ContinuationSession.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  createPlaybackSessionStore,
} from '../playbackSession/PlaybackSessionStore.ts'
import { createPlaybackSessionPersistence } from '../playbackSession/persistence.ts'
import {
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
} from '../sessionSwitch/featureFlag.ts'
import { createControllablePlayerAdapter } from '../sessionSwitch/integration/ControllablePlayerAdapter.ts'
import { createSessionSwitchRuntime } from '../sessionSwitch/integration/createSessionSwitchRuntime.ts'
import {
  bindCmeSessionOwnership,
  getCmeSessionOwnership,
  isCmeLiveMutationAllowed,
  resetCmeSessionOwnershipForTests,
} from '../sessionSwitch/integration/cmeSessionOwnership.ts'
import { playSwipeViaSessionSwitch } from '../sessionSwitch/integration/playSwipeSession.ts'
import {
  getSessionSwitchAppRuntime,
  resetSessionSwitchAppRuntimeForTests,
  setSessionSwitchAppRuntime,
} from '../sessionSwitch/integration/sessionSwitchAppRuntime.ts'
import {
  consumeRecommendationAdvance,
  resolveRecommendationAdvance,
} from './advance.ts'
import {
  getContinuousBufferGeneration,
  getContinuousBufferSize,
  pushContinuousBufferedTracks,
  resetContinuousBufferForTests,
} from './continuousBuffer.ts'
import {
  activateRecommendationSession,
  clearRecommendationSession,
} from './sessionRuntime.ts'
import {
  clearRecommendationMiss,
  isRecommendationExhausted,
  peekRecommendationMiss,
  resetRecommendationSessionStateForTests,
  takeRecommendationMiss,
} from './sessionState.ts'

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
    sourceId: 'dev-acceptance',
    externalId: id,
    title: `T ${id}`,
    artist: 'A',
  }
}

function urlFor(id: string) {
  return `https://cdn.test/${id}.mp3`
}

describe('PLAYBACK-FIX-01 SWIPES Next ownership / buffer', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    resetCmeSessionOwnershipForTests()
    resetContinuousBufferForTests()
    resetRecommendationSessionStateForTests()
    clearRecommendationMiss()
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

  it('heals stale switchEpoch and advances from buffer without losing candidate', async () => {
    const { store, live } = setupRuntime()
    await playSwipeViaSessionSwitch({ track: track('seed') })
    activateRecommendationSession('swipe', { forceProvider: true })
    assert.equal(store.getActiveSessionId(), 'swipes')
    assert.equal(isCmeLiveMutationAllowed(), true)

    const next = track('next-1')
    pushContinuousBufferedTracks([next], {
      generation: getContinuousBufferGeneration(),
    })
    assert.equal(getContinuousBufferSize(), 1)

    bindCmeSessionOwnership({
      sessionId: 'swipes',
      switchEpoch: store.getSwitchEpoch() - 1,
    })
    assert.notEqual(
      getCmeSessionOwnership()?.switchEpoch,
      store.getSwitchEpoch(),
    )

    const session = getContinuationSession()
    const advanced = consumeRecommendationAdvance(live, session, {
      fromEnded: false,
    })
    assert.equal(advanced?.id, 'next-1')
    assert.equal(live.current()?.id, 'next-1')
    assert.equal(getContinuousBufferSize(), 0)
    assert.equal(getCmeSessionOwnership()?.switchEpoch, store.getSwitchEpoch())
  })

  it('empty discovery notes soft miss (no permanent exhausted without take)', async () => {
    setupRuntime()
    await playSwipeViaSessionSwitch({ track: track('seed') })
    activateRecommendationSession('swipe', { forceProvider: true })
    const live = getPlaybackQueue()
    const session = new ContinuationSession()
    session.setProvider({
      async prepareContinuation() {
        return null
      },
    })

    const result = await resolveRecommendationAdvance(live, session, {
      fromEnded: false,
    })
    assert.equal(result, null)
    const miss = peekRecommendationMiss()
    assert.ok(miss)
    assert.equal(miss!.soft, true)
    assert.equal(isRecommendationExhausted(), false)
    assert.equal(takeRecommendationMiss()?.soft, true)
  })
})
