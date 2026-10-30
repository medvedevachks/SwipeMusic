/**
 * PLAYBACK-DEV-05A — runtime gate через Vite SSR (реальный класс AudioPlayer).
 * Запуск: node --experimental-strip-types scripts/session-switch-integration-gate.mts
 * Не трогает production UI / PlaybackIntent.
 */
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

type GateResult = { name: string; ok: boolean; detail?: string }

const results: GateResult[] = []

function record(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      results.push({ name, ok: true })
      console.log(`PASS ${name}`)
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      results.push({ name, ok: false, detail })
      console.error(`FAIL ${name}: ${detail}`)
    })
}

function installDomShim(): void {
  const window = new Window({ url: 'http://127.0.0.1:5173/' })
  const g = globalThis as typeof globalThis & Record<string, unknown>
  const define = (key: string, value: unknown) => {
    try {
      Object.defineProperty(g, key, {
        configurable: true,
        writable: true,
        value,
      })
    } catch {
      try {
        g[key] = value
      } catch {
        /* read-only in this runtime */
      }
    }
  }
  define('window', window)
  define('document', window.document)
  define('localStorage', window.localStorage)
  define('sessionStorage', window.sessionStorage)
  define('indexedDB', window.indexedDB)
  define('IDBKeyRange', window.IDBKeyRange)
  define('HTMLElement', window.HTMLElement)
  define('Event', window.Event)
  define('CustomEvent', window.CustomEvent)
  // Minimal HTMLAudioElement for LocalPlayerAdapter / PlayerManager ctor
  class GateAudio {
    src = ''
    currentTime = 0
    duration = NaN
    paused = true
    volume = 1
    muted = false
    playbackRate = 1
    preload = 'auto'
    crossOrigin: string | null = null
    onplay: ((ev: Event) => void) | null = null
    onpause: ((ev: Event) => void) | null = null
    onended: ((ev: Event) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    ontimeupdate: ((ev: Event) => void) | null = null
    onloadedmetadata: ((ev: Event) => void) | null = null
    onwaiting: ((ev: Event) => void) | null = null
    oncanplay: ((ev: Event) => void) | null = null
    onloadstart: ((ev: Event) => void) | null = null
    onratechange: ((ev: Event) => void) | null = null
    onvolumechange: ((ev: Event) => void) | null = null
    addEventListener(): void {}
    removeEventListener(): void {}
    load(): void {}
    play(): Promise<void> {
      this.paused = false
      return Promise.resolve()
    }
    pause(): void {
      this.paused = true
    }
  }
  define('Audio', GateAudio)
  define('HTMLAudioElement', GateAudio)
}

async function main(): Promise<void> {
  installDomShim()

  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })

  try {
    const audioMod = await server.ssrLoadModule(
      '/src/services/audioPlayer/AudioPlayer.ts',
    )
    const controllableMod = await server.ssrLoadModule(
      '/src/services/sessionSwitch/integration/ControllablePlayerAdapter.ts',
    )
    const queueMod = await server.ssrLoadModule(
      '/src/services/playbackQueue/PlaybackQueue.ts',
    )
    const flagMod = await server.ssrLoadModule(
      '/src/services/sessionSwitch/featureFlag.ts',
    )
    const bootstrapMod = await server.ssrLoadModule(
      '/src/services/sessionSwitch/integration/bootstrapSessionPlayback.ts',
    )
    const pmMod = await server.ssrLoadModule(
      '/src/services/audioPlayer/PlayerManager.ts',
    )
    const resolverMod = await server.ssrLoadModule(
      '/src/services/playbackResolver/PlaybackResolver.ts',
    )

    type Player = {
      getPlayGeneration(): number
      getState(): {
        currentTrack: { id: string; previewUrl?: string | null } | null
        pendingTrack: { id: string } | null
        playing: boolean
        paused: boolean
        error: string | null
      }
      playTrack(track: unknown): Promise<void>
      pause(): void
      next(): Promise<void>
      previous(): Promise<void>
      resume(): Promise<void>
      clearPlaybackIdentity(): void
      commitSessionPlay(input: {
        track: unknown
        url: string
        candidate: null
      }): Promise<{ ok: boolean; reason?: string; playerGeneration?: number }>
      resolveForSessionPrepare(
        track: unknown,
        signal?: AbortSignal,
      ): Promise<{ url: string } | null>
    }

    const { AudioPlayer } = audioMod as {
      AudioPlayer: new (adapter?: unknown) => Player
    }
    const { createControllablePlayerAdapter } = controllableMod as {
      createControllablePlayerAdapter: () => {
        load(url: string): Promise<void>
        play(): Promise<void>
        pause(): void
        seek(t: number): void
        isPlaying(): boolean
        getActiveBackend(): { id: string; url: string | null; playing: boolean }
        hadDualPlayback(): boolean
        setLoadDelay(ms: number): void
        failNextLoad(): void
        failNextPlay(kind?: boolean | 'NotAllowedError'): void
        local: { playCount: number; pauseCount: number; loadCount: number }
        spotify: { playCount: number; playing: boolean }
      }
    }
    const { getPlaybackQueue } = queueMod as {
      getPlaybackQueue: () => {
        clear(): void
        detachLegacyPersistence(): void
        setQueue(tracks: unknown[], index: number, ctx: unknown): void
        current(): { id: string } | null
        getItems(): { id: string }[]
        next(): { id: string } | null
        previous(): { id: string } | null
      }
    }
    const {
      isSessionSwitchIntegrationEnabled,
      setSessionSwitchIntegrationEnabledForTests,
      resetSessionSwitchIntegrationFlagForTests,
    } = flagMod as {
      isSessionSwitchIntegrationEnabled: () => boolean
      setSessionSwitchIntegrationEnabledForTests: (v: boolean | null) => void
      resetSessionSwitchIntegrationFlagForTests: () => void
    }
    const { handoffLiveQueueAfterAuth, teardownLiveQueueOnLogout } =
      bootstrapMod as {
        handoffLiveQueueAfterAuth: (input: {
          userId: string
          deviceId: string
          previousUserId: string | null
          player?: { clearPlaybackIdentity(): void }
        }) => {
          discardedUntrustedQueue: boolean
          clearedPlayerIdentity: boolean
        }
        teardownLiveQueueOnLogout: (
          queue?: unknown,
          player?: { clearPlaybackIdentity(): void },
        ) => void
      }
    const { PlayerManager } = pmMod as {
      PlayerManager: new () => {
        load(url: string): Promise<void>
        play(): Promise<void>
        pause(): Promise<void>
        isPlaying(): boolean
        getActiveSourceId(): string
      }
    }
    const { getPlaybackResolver } = resolverMod as {
      getPlaybackResolver: () => {
        resolve: (track: { id: string }) => Promise<{
          url: string
          candidate: unknown
          trackId: string
          candidates: unknown[]
        } | null>
      }
    }

    // Stub resolver — без сети / IndexedDB side-effects от провайдеров
    const resolver = getPlaybackResolver()
    const originalResolve = resolver.resolve.bind(resolver)
    resolver.resolve = async (t: { id: string }) => ({
      trackId: t.id,
      url: `https://cdn.test/${t.id}.mp3`,
      candidate: {
        id: `cand:${t.id}`,
        providerId: 'local',
        type: 'stream',
        priority: 1,
        available: true,
        url: `https://cdn.test/${t.id}.mp3`,
      },
      candidates: [],
    })

    const track = (id: string) => ({
      id,
      sourceId: 'local',
      externalId: id,
      title: id,
      artist: 'Gate',
    })

    await record('flag OFF by default (non-PROD)', () => {
      resetSessionSwitchIntegrationFlagForTests()
      assert.equal(isSessionSwitchIntegrationEnabled(), false)
    })

    await record('legacy playTrack / pause / resume / next / previous', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.clear()
      const a = track('leg-a')
      const b = track('leg-b')
      queue.setQueue([a, b], 0, { type: 'none' })

      await player.playTrack(a)
      assert.equal(player.getState().currentTrack?.id, 'leg-a')
      assert.equal(player.getState().playing, true)
      assert.equal(player.getState().pendingTrack, null)

      player.pause()
      assert.equal(player.getState().playing, false)
      assert.equal(player.getState().paused, true)

      await player.resume()
      assert.equal(player.getState().playing, true)

      await player.next()
      assert.equal(player.getState().currentTrack?.id, 'leg-b')

      await player.previous()
      assert.equal(player.getState().currentTrack?.id, 'leg-a')
    })

    await record('legacy load failure sets error without success playing', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.clear()
      const bad = track('leg-fail')
      queue.setQueue([bad], 0, { type: 'none' })
      adapter.failNextLoad()
      await assert.rejects(() => player.playTrack(bad))
      assert.equal(player.getState().playing, false)
      assert.ok(player.getState().error)
    })

    await record('Prepare does not pause sounding track', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.clear()
      queue.setQueue([track('wave')], 0, { type: 'none' })
      await player.playTrack(track('wave'))
      const pausesBefore = adapter.local.pauseCount
      const prepared = await player.resolveForSessionPrepare(track('search'))
      assert.ok(prepared?.url)
      assert.equal(adapter.local.pauseCount, pausesBefore)
      assert.equal(player.getState().currentTrack?.id, 'wave')
      assert.equal(player.getState().playing, true)
    })

    await record('commitSessionPlay updates currentTrack only after load', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      adapter.setLoadDelay(30)
      const pending: string[] = []
      const unsub = (player as unknown as {
        subscribe: (fn: (s: Player['getState'] extends () => infer S ? S : never) => void) => () => void
      }).subscribe?.(() => {
        /* optional */
      })
      void unsub

      const p = player.commitSessionPlay({
        track: track('commit-1'),
        url: 'https://cdn.test/commit-1.mp3',
        candidate: null,
      })
      // Сразу после старта — ещё не sounding identity (pending может быть)
      await new Promise((r) => setTimeout(r, 5))
      const mid = player.getState()
      assert.equal(mid.playing, false)
      // currentTrack ещё не commit-1 пока load не завершился, либо уже null/old
      if (mid.currentTrack?.id === 'commit-1') {
        pending.push('early-commit')
      }
      assert.equal(pending.includes('early-commit'), false)
      assert.equal(mid.pendingTrack?.id, 'commit-1')

      const result = await p
      assert.equal(result.ok, true)
      assert.equal(player.getState().currentTrack?.id, 'commit-1')
      assert.equal(player.getState().pendingTrack, null)
      assert.equal(player.getState().playing, true)
    })

    await record('stale playTrack cannot stop newer commitSessionPlay', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.clear()
      queue.setQueue([track('old'), track('new')], 0, { type: 'none' })

      adapter.setLoadDelay(80)
      const slowLegacy = player.playTrack(track('old'))
      await new Promise((r) => setTimeout(r, 10))
      adapter.setLoadDelay(0)
      const commit = await player.commitSessionPlay({
        track: track('new'),
        url: 'https://cdn.test/new.mp3',
        candidate: null,
      })
      assert.equal(commit.ok, true)
      await slowLegacy.catch(() => undefined)
      assert.equal(player.getState().currentTrack?.id, 'new')
      assert.equal(adapter.getActiveBackend().url, 'https://cdn.test/new.mp3')
      assert.equal(player.getState().playing, true)
    })

    await record('stale commit cannot overwrite newer playTrack', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.clear()
      queue.setQueue([track('legacy-winner')], 0, { type: 'none' })

      adapter.setLoadDelay(80)
      const slowCommit = player.commitSessionPlay({
        track: track('session-slow'),
        url: 'https://cdn.test/session-slow.mp3',
        candidate: null,
      })
      await new Promise((r) => setTimeout(r, 10))
      adapter.setLoadDelay(0)
      await player.playTrack(track('legacy-winner'))
      const slow = await slowCommit
      assert.equal(slow.ok, false)
      assert.equal(player.getState().currentTrack?.id, 'legacy-winner')
      assert.equal(adapter.getActiveBackend().url, 'https://cdn.test/legacy-winner.mp3')
    })

    await record('source adapter switch via controllable dual backend', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      await player.commitSessionPlay({
        track: track('local-1'),
        url: 'https://cdn.test/local-1.mp3',
        candidate: null,
      })
      assert.equal(adapter.getActiveBackend().id, 'local')
      await player.commitSessionPlay({
        track: { ...track('sp-1'), sourceId: 'spotify' },
        url: 'spotify:track:sp-1',
        candidate: null,
      })
      assert.equal(adapter.getActiveBackend().id, 'spotify')
      assert.equal(adapter.local.playing, false)
      assert.equal(adapter.hadDualPlayback(), false)
    })

    await record('NotAllowedError → user_gesture_required', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      adapter.failNextPlay('NotAllowedError')
      const result = await player.commitSessionPlay({
        track: track('gesture'),
        url: 'https://cdn.test/gesture.mp3',
        candidate: null,
      })
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'user_gesture_required')
      assert.equal(player.getState().playing, false)
    })

    await record('PlayerManager load stays on one active source', async () => {
      const manager = new PlayerManager()
      assert.equal(manager.getActiveSourceId(), 'local')
      await manager.load('https://cdn.test/pm-local.mp3')
      await manager.play()
      assert.equal(manager.getActiveSourceId(), 'local')
      assert.equal(manager.isPlaying(), true)
      // pause backends semantics: second load should not leave prior playing
      await manager.pause()
      assert.equal(manager.isPlaying(), false)
    })

    await record('auth handoff discards previous user queue + player identity', async () => {
      const adapter = createControllablePlayerAdapter()
      const player = new AudioPlayer(adapter)
      const queue = getPlaybackQueue()
      queue.detachLegacyPersistence()
      queue.setQueue([track('secret-u1')], 0, { type: 'none' })
      await player.playTrack(track('secret-u1'))
      assert.equal(player.getState().currentTrack?.id, 'secret-u1')

      teardownLiveQueueOnLogout(queue, player)
      assert.equal(queue.current(), null)
      assert.equal(player.getState().currentTrack, null)
      assert.equal(player.getState().playing, false)

      // Simulate leftover identity if only queue cleared — handoff must clear player
      await player.commitSessionPlay({
        track: track('stale-ui'),
        url: 'https://cdn.test/stale-ui.mp3',
        candidate: null,
      })
      assert.equal(player.getState().currentTrack?.id, 'stale-ui')

      const handoff = handoffLiveQueueAfterAuth({
        userId: 'user-2',
        deviceId: 'device-1',
        previousUserId: 'user-1',
        player,
      })
      assert.equal(handoff.discardedUntrustedQueue, true)
      assert.equal(handoff.clearedPlayerIdentity, true)
      assert.equal(queue.current(), null)
      assert.equal(player.getState().currentTrack, null)
    })

    await record('flag test override resets', () => {
      setSessionSwitchIntegrationEnabledForTests(true)
      assert.equal(isSessionSwitchIntegrationEnabled(), true)
      resetSessionSwitchIntegrationFlagForTests()
      assert.equal(isSessionSwitchIntegrationEnabled(), false)
    })

    // restore resolver (best-effort)
    resolver.resolve = originalResolve
  } finally {
    await server.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nGate summary: ${results.length - failed.length}/${results.length} passed`,
  )
  if (failed.length > 0) {
    for (const f of failed) {
      console.error(` - ${f.name}: ${f.detail}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
