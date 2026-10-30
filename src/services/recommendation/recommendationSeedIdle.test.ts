/**
 * Cold seed idle guard — PLAYBACK-CME-01 §1.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
} from '../sessionSwitch/featureFlag.ts'
import { resetSessionSwitchAppRuntimeForTests } from '../sessionSwitch/integration/sessionSwitchAppRuntime.ts'
import { isRecommendationSeedIdle } from './recommendationSeedIdle.ts'
import {
  commitRecommendationSeed,
  clearRecommendationSession,
} from './sessionRuntime.ts'
import {
  getRecommendationAdvanceEpoch,
  invalidateRecommendationAdvance,
} from './advanceEpoch.ts'

describe('recommendationSeedIdle', () => {
  beforeEach(() => {
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    clearRecommendationSession()
    const q = getPlaybackQueue()
    q.detachLegacyPersistence()
    q.clear()
  })

  afterEach(() => {
    resetSessionSwitchIntegrationFlagForTests()
    resetSessionSwitchAppRuntimeForTests()
    clearRecommendationSession()
  })

  it('idle when queue empty', () => {
    assert.equal(isRecommendationSeedIdle(), true)
  })

  it('not idle when queue has items', () => {
    getPlaybackQueue().setQueue(
      [
        {
          id: 'a',
          sourceId: 'local',
          externalId: 'a',
          title: 'A',
          artist: 'X',
        },
      ],
      0,
      { type: 'swipe' },
    )
    assert.equal(isRecommendationSeedIdle(), false)
  })

  it('cold seed no-op when queue occupied (requireIdleQueue)', async () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    getPlaybackQueue().setQueue(
      [
        {
          id: 'keep',
          sourceId: 'local',
          externalId: 'keep',
          title: 'Keep',
          artist: 'X',
        },
      ],
      0,
      { type: 'none' },
    )
    const epoch = getRecommendationAdvanceEpoch()
    const result = await commitRecommendationSeed({
      mode: 'swipe',
      track: {
        id: 'cold',
        sourceId: 'local',
        externalId: 'cold',
        title: 'Cold',
        artist: 'Y',
      },
      autoplay: false,
      requireIdleQueue: true,
      expectedAdvanceEpoch: epoch,
    })
    assert.equal(result.ok, false)
    assert.equal(getPlaybackQueue().current()?.id, 'keep')
  })

  it('cold seed no-op when advance epoch changed', async () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    const epoch = getRecommendationAdvanceEpoch()
    invalidateRecommendationAdvance()
    const result = await commitRecommendationSeed({
      mode: 'swipe',
      track: {
        id: 'cold',
        sourceId: 'local',
        externalId: 'cold',
        title: 'Cold',
        artist: 'Y',
      },
      autoplay: false,
      requireIdleQueue: true,
      expectedAdvanceEpoch: epoch,
    })
    assert.equal(result.ok, false)
    assert.equal(getPlaybackQueue().getItems().length, 0)
  })
})
