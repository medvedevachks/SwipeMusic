/**
 * DEV-only browser gate harness (VITE_SESSION_SWITCH_GATE=true).
 * Не подключает PlaybackIntent / production UI.
 * Результаты — window.__SWIPE_SESSION_SWITCH_GATE__.
 */
import { AudioPlayer } from '../../audioPlayer/AudioPlayer.ts'
import { getPlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import {
  handoffLiveQueueAfterAuth,
  teardownLiveQueueOnLogout,
} from './bootstrapSessionPlayback.ts'
import { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
import {
  isSessionSwitchIntegrationEnabled,
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
} from '../featureFlag.ts'
import { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
import { createPlaybackSessionStore } from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import type { SessionQueueSnapshot } from '../../playbackSession/types.ts'
import { createEmptySessionQueueSnapshot } from '../../playbackSession/PlaybackSessionStore.ts'

export type GateScenarioResult = {
  id: string
  ok: boolean
  detail?: string
}

function track(id: string) {
  return toSessionTrack({
    id,
    sourceId: 'local',
    externalId: id,
    title: id,
    artist: 'Gate',
  })
}

function queueOf(ids: string[]): SessionQueueSnapshot {
  const items = ids.map(track)
  return {
    ...createEmptySessionQueueSnapshot(new Date().toISOString()),
    items,
    currentIndex: 0,
    playOrder: items.map((_, i) => i),
    playOrderIndex: 0,
    history: ids[0] ? [ids[0]] : [],
    historyIndex: ids[0] ? 0 : -1,
    phase: 'playing',
    positionSeconds: 0,
  }
}

async function runScenario(
  id: string,
  fn: () => void | Promise<void>,
): Promise<GateScenarioResult> {
  try {
    await fn()
    return { id, ok: true }
  } catch (error) {
    return {
      id,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runSessionSwitchBrowserGate(): Promise<{
  results: GateScenarioResult[]
  passed: number
  failed: number
}> {
  const results: GateScenarioResult[] = []
  const push = async (id: string, fn: () => void | Promise<void>) => {
    results.push(await runScenario(id, fn))
  }

  await push('flag-off-default', () => {
    resetSessionSwitchIntegrationFlagForTests()
    if (isSessionSwitchIntegrationEnabled()) {
      throw new Error('flag expected OFF')
    }
  })

  await push('flag-off-no-runtime', () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    const store = createPlaybackSessionStore({
      userId: 'u1',
      deviceId: 'device-1',
    })
    const runtime = createSessionSwitchRuntime({
      store,
      resolve: async () => null,
      adapter: createControllablePlayerAdapter(),
    })
    if (runtime !== null) {
      throw new Error('runtime must be null when flag OFF')
    }
  })

  await push('prepare-does-not-pause', async () => {
    setSessionSwitchIntegrationEnabledForTests(true)
    const adapter = createControllablePlayerAdapter()
    const player = new AudioPlayer(adapter)
    await adapter.load('https://cdn.test/wave.mp3')
    await adapter.play()
    const pauses = adapter.local.pauseCount
    // resolve may miss in browser without providers — still must not pause
    await player.resolveForSessionPrepare({
      id: 'x',
      sourceId: 'local',
      externalId: 'x',
      title: 'x',
      artist: 'a',
    })
    if (adapter.local.pauseCount !== pauses) {
      throw new Error('Prepare paused sounding adapter')
    }
    if (!adapter.isPlaying()) {
      throw new Error('Prepare stopped playback')
    }
  })

  await push('commit-switches-sound', async () => {
    const adapter = createControllablePlayerAdapter()
    const player = new AudioPlayer(adapter)
    await player.commitSessionPlay({
      track: {
        id: 'a',
        sourceId: 'local',
        externalId: 'a',
        title: 'a',
        artist: 'x',
      },
      url: 'https://cdn.test/a.mp3',
      candidate: null,
    })
    const mid = player.getState()
    if (mid.currentTrack?.id !== 'a' || !mid.playing) {
      throw new Error('commit A failed')
    }
    await player.commitSessionPlay({
      track: {
        id: 'b',
        sourceId: 'local',
        externalId: 'b',
        title: 'b',
        artist: 'x',
      },
      url: 'https://cdn.test/b.mp3',
      candidate: null,
    })
    const after = player.getState()
    if (after.currentTrack?.id !== 'b' || after.pendingTrack) {
      throw new Error('commit B identity mismatch')
    }
  })

  await push('commit-fail-keeps-prior-on-adapter-port', async () => {
    setSessionSwitchIntegrationEnabledForTests(true)
    const adapter = createControllablePlayerAdapter()
    const store = createPlaybackSessionStore({
      userId: 'u1',
      deviceId: 'device-1',
    })
    const live = getPlaybackQueue()
    live.detachLegacyPersistence()
    live.clear()
    const wave = queueOf(['wave-1'])
    store.replaceSlot('wave', { meta: { kind: 'wave' }, queue: wave })
    store.setActiveSessionId('wave')
    live.importSessionState({
      items: wave.items.map((i) => ({ ...i, previewUrl: null })),
      currentIndex: 0,
      playOrder: [0],
      playOrderIndex: 0,
      repeatMode: 'OFF',
      shuffleMode: 'OFF',
      history: ['wave-1'],
      historyIndex: 0,
      context: { type: 'none' },
      sessionTailIds: [],
    })
    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: live,
      adapter,
      forceEnable: true,
      resolve: async (t) => ({
        url: `https://cdn.test/${t.id}.mp3`,
        candidate: null,
      }),
    })
    if (!runtime) {
      throw new Error('runtime missing')
    }
    const physical = runtime.player as unknown as {
      seedPlaying: (t: unknown, url: string, pos?: number) => void
      getCurrentTrackId: () => string | null
    }
    physical.seedPlaying(
      {
        id: 'wave-1',
        sourceId: 'local',
        externalId: 'wave-1',
        title: 'wave-1',
        artist: 'a',
        previewUrl: 'https://cdn.test/wave-1.mp3',
      },
      'https://cdn.test/wave-1.mp3',
      5,
    )
    await adapter.load('https://cdn.test/wave-1.mp3')
    await adapter.play()
    adapter.failNextLoad()
    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: { kind: 'search', query: 'q', seedTrackId: null },
      targetQueue: queueOf(['fail-1']),
      startTrackId: 'fail-1',
    })
    if (result.ok) {
      throw new Error('expected commit fail')
    }
    if (store.getActiveSessionId() !== 'wave') {
      throw new Error('rollback active session')
    }
    if (physical.getCurrentTrackId() !== 'wave-1') {
      throw new Error('rollback currentTrack')
    }
  })

  await push('not-allowed-not-success', async () => {
    const adapter = createControllablePlayerAdapter()
    const player = new AudioPlayer(adapter)
    adapter.failNextPlay('NotAllowedError')
    const result = await player.commitSessionPlay({
      track: {
        id: 'g',
        sourceId: 'local',
        externalId: 'g',
        title: 'g',
        artist: 'a',
      },
      url: 'https://cdn.test/g.mp3',
      candidate: null,
    })
    if (result.ok || result.reason !== 'user_gesture_required') {
      throw new Error(`expected user_gesture_required, got ${JSON.stringify(result)}`)
    }
    if (player.getState().playing) {
      throw new Error('playing after NotAllowedError')
    }
  })

  await push('logout-clears-player-identity', async () => {
    const adapter = createControllablePlayerAdapter()
    const player = new AudioPlayer(adapter)
    await player.commitSessionPlay({
      track: {
        id: 'u1-track',
        sourceId: 'local',
        externalId: 'u1-track',
        title: 'u1',
        artist: 'a',
      },
      url: 'https://cdn.test/u1.mp3',
      candidate: null,
    })
    teardownLiveQueueOnLogout(getPlaybackQueue(), player)
    if (player.getState().currentTrack !== null) {
      throw new Error('currentTrack leaked after logout')
    }
    const handoff = handoffLiveQueueAfterAuth({
      userId: 'u2',
      deviceId: 'device-1',
      previousUserId: 'u1',
      player,
    })
    if (!handoff.clearedPlayerIdentity) {
      throw new Error('handoff did not clear player')
    }
  })

  resetSessionSwitchIntegrationFlagForTests()
  const failed = results.filter((r) => !r.ok).length
  return {
    results,
    passed: results.length - failed,
    failed,
  }
}

export function installSessionSwitchBrowserGate(): void {
  if (typeof window === 'undefined') {
    return
  }
  ;(
    window as unknown as {
      __SWIPE_SESSION_SWITCH_GATE__?: {
        run: typeof runSessionSwitchBrowserGate
      }
    }
  ).__SWIPE_SESSION_SWITCH_GATE__ = {
    run: runSessionSwitchBrowserGate,
  }
  console.info('[session-switch-gate] harness ready: window.__SWIPE_SESSION_SWITCH_GATE__.run()')
}
