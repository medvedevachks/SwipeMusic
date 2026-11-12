import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYBACK_QUEUE_STORAGE_KEY } from '../playbackQueue/PlaybackQueue.ts'
import { bindPlaybackSessionsForAuth } from './integration/playbackSessionBootstrap.ts'
import {
  applySessionSwitchServerDecision,
  isSessionSwitchIntegrationEnabled,
  refreshSessionSwitchFromServer,
  resetSessionSwitchIntegrationFlagForTests,
  SESSION_SWITCH_INTEGRATION_STORAGE_KEY,
  setSessionSwitchProductionForTests,
} from './featureFlag.ts'

const LIBRARY_KEY = 'swipe-music-user-library-probe'
const SESSION_KEY = 'swipe-music-playback-sessions-v2/meta:probe'

function installMemoryStorage(): Map<string, string> {
  const bag = new Map<string, string>()
  const storage = {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bag.set(key, value)
    },
    removeItem: (key: string) => {
      bag.delete(key)
    },
    clear: () => {
      bag.clear()
    },
    key: (index: number) => [...bag.keys()][index] ?? null,
    get length() {
      return bag.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  return bag
}

test('production ignores localStorage and stays OFF until the server says true', async () => {
  const bag = installMemoryStorage()
  bag.set(SESSION_SWITCH_INTEGRATION_STORAGE_KEY, '1')
  bag.set(PLAYBACK_QUEUE_STORAGE_KEY, '{"items":[1]}')
  bag.set(LIBRARY_KEY, 'kept')
  bag.set(SESSION_KEY, '{}')
  setSessionSwitchProductionForTests(true)
  applySessionSwitchServerDecision(null)
  assert.equal(isSessionSwitchIntegrationEnabled(), false)

  const enabled = await refreshSessionSwitchFromServer(async () => {
    throw new Error('offline')
  })
  assert.equal(enabled, false)
  assert.equal(bag.get(PLAYBACK_QUEUE_STORAGE_KEY), '{"items":[1]}')
  assert.equal(bag.get(LIBRARY_KEY), 'kept')
  assert.equal(bag.get(SESSION_KEY), '{}')

  await refreshSessionSwitchFromServer(async () => ({
    ok: true,
    json: async () => ({ sessionSwitch: true }),
  }) as Response)
  assert.equal(isSessionSwitchIntegrationEnabled(), true)

  await refreshSessionSwitchFromServer(async () => ({
    ok: true,
    json: async () => ({ sessionSwitch: false }),
  }) as Response)
  assert.equal(isSessionSwitchIntegrationEnabled(), false)
  assert.equal(bag.get(LIBRARY_KEY), 'kept')
  assert.equal(bag.get(SESSION_KEY), '{}')
  assert.equal(bag.get(PLAYBACK_QUEUE_STORAGE_KEY), '{"items":[1]}')

  const bound = await bindPlaybackSessionsForAuth('user-probe')
  assert.equal(bound.reason, 'flag_off')
  assert.equal(bound.audioAutoplay, false)
  assert.equal(bag.get(LIBRARY_KEY), 'kept')

  resetSessionSwitchIntegrationFlagForTests()
})

test('DEV localStorage still enables when the server has not allowed production', () => {
  const bag = installMemoryStorage()
  bag.set(SESSION_SWITCH_INTEGRATION_STORAGE_KEY, '1')
  setSessionSwitchProductionForTests(false)
  applySessionSwitchServerDecision(null)
  assert.equal(isSessionSwitchIntegrationEnabled(), true)
  resetSessionSwitchIntegrationFlagForTests()
})
