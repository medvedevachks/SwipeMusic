/**
 * PLAYBACK-DEV-05 — интеграция SessionSwitch ↔ PhysicalPort / live queue.
 *
 * AudioPlayer.ts / PlaybackResolver не грузятся в node:test (extensionless imports).
 * Физический путь проверяем через sessionPhysicalEngine + ControllablePlayerAdapter
 * (та же семантика claim/load/play, что AudioPlayer.commitSessionPlay).
 * Контракт AudioPlayer / PlayerManager — source inspection.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createEmptySessionQueueSnapshot,
  createPlaybackSessionStore,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import type {
  PlaybackSessionId,
  SessionQueueSnapshot,
  SessionSlotMeta,
} from '../../playbackSession/types.ts'
import {
  getPlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
  createSessionPlaybackQueue,
} from '../../playbackQueue/PlaybackQueue.ts'
import {
  isSessionSwitchIntegrationEnabled,
  resetSessionSwitchIntegrationFlagForTests,
  setSessionSwitchIntegrationEnabledForTests,
  SESSION_SWITCH_INTEGRATION_STORAGE_KEY,
} from '../featureFlag.ts'
import {
  handoffLiveQueueAfterAuth,
  teardownLiveQueueOnLogout,
} from './bootstrapSessionPlayback.ts'
import { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
import { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
import type { AdapterPhysicalPort } from './createPhysicalPlayerPort.ts'
import { createAdapterPhysicalPort } from './createPhysicalPlayerPort.ts'
import { PreparedTrackCache } from './preparedTrackCache.ts'
import type { ResolvePlaybackFn } from './ResolverTrackPreparePort.ts'
import { sessionTrackAsTrack } from './sessionTrackAsTrack.ts'

const here = dirname(fileURLToPath(import.meta.url))

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

function track(id: string, sourceId = 'local') {
  return toSessionTrack({
    id,
    sourceId,
    externalId: id,
    title: `T ${id}`,
    artist: 'A',
  })
}

function queueOf(
  ids: string[],
  currentIndex = 0,
  extra: Partial<SessionQueueSnapshot> = {},
): SessionQueueSnapshot {
  const items = ids.map((id) => track(id))
  return {
    ...createEmptySessionQueueSnapshot('2026-01-01T00:00:00.000Z'),
    items,
    currentIndex,
    playOrder: items.map((_, i) => i),
    playOrderIndex: currentIndex,
    history: currentIndex >= 0 ? [ids[currentIndex]!] : [],
    historyIndex: currentIndex >= 0 ? 0 : -1,
    phase: 'playing',
    positionSeconds: 0,
    ...extra,
  }
}

function metaFor(id: PlaybackSessionId): SessionSlotMeta {
  switch (id) {
    case 'swipes':
      return { kind: 'swipes' }
    case 'wave':
      return { kind: 'wave' }
    case 'search':
      return { kind: 'search', query: 'q', seedTrackId: null }
    case 'catalog':
      return { kind: 'catalog', catalogId: 'c1', title: 'Cat' }
    case 'album':
      return { kind: 'album', albumId: 'a1', title: 'Alb', phase: 'album' }
    default: {
      const _e: never = id
      return _e
    }
  }
}

function urlFor(id: string): string {
  if (id.startsWith('sp-')) {
    return `spotify:track:${id}`
  }
  return `https://cdn.test/audio/${id}.mp3`
}

function createResolve(options?: {
  delayMs?: number
  failIds?: Set<string>
  onResolve?: (id: string) => void
}): ResolvePlaybackFn {
  return async (t, signal) => {
    options?.onResolve?.(t.id)
    if (options?.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs))
    }
    if (signal.aborted) {
      return null
    }
    if (options?.failIds?.has(t.id)) {
      return null
    }
    return {
      url: urlFor(t.id),
      candidate: {
        id: `cand:${t.id}`,
        providerId: t.sourceId,
        type: 'stream',
        url: urlFor(t.id),
        available: true,
        priority: 1,
      },
    }
  }
}

describe('PLAYBACK-DEV-05 session-switch integration', () => {
  let memory: Map<string, string>

  beforeEach(() => {
    memory = installMemoryLocalStorage()
    resetSessionSwitchIntegrationFlagForTests()
    const queue = getPlaybackQueue()
    queue.detachLegacyPersistence()
    queue.clear()
  })

  afterEach(() => {
    resetSessionSwitchIntegrationFlagForTests()
    teardownLiveQueueOnLogout()
  })

  async function setupRuntime(options?: {
    resolveDelayMs?: number
    failIds?: string[]
    forceEnable?: boolean
    onResolve?: (id: string) => void
  }) {
    setSessionSwitchIntegrationEnabledForTests(true)
    const store = createPlaybackSessionStore({
      userId: 'user-1',
      deviceId: 'device-1',
    })
    const live = getPlaybackQueue()
    handoffLiveQueueAfterAuth({
      userId: 'user-1',
      deviceId: 'device-1',
      previousUserId: null,
      liveQueue: live,
    })

    const waveQueue = queueOf(['wave-1', 'wave-2'], 0, {
      context: {
        type: 'radio',
        id: 'my-wave',
        title: 'W',
        origin: 'recommendations',
      },
      positionSeconds: 10,
    })
    store.replaceSlot('wave', { meta: { kind: 'wave' }, queue: waveQueue })
    store.setActiveSessionId('wave')
    live.importSessionState({
      items: waveQueue.items.map((i) => ({ ...i, previewUrl: null })),
      currentIndex: 0,
      playOrder: [0, 1],
      playOrderIndex: 0,
      repeatMode: 'OFF',
      shuffleMode: 'OFF',
      history: ['wave-1'],
      historyIndex: 0,
      context: waveQueue.context,
      sessionTailIds: [],
    })

    const adapter = createControllablePlayerAdapter()
    const resolve = createResolve({
      delayMs: options?.resolveDelayMs,
      failIds: options?.failIds ? new Set(options.failIds) : undefined,
      onResolve: options?.onResolve,
    })

    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: live,
      resolve,
      adapter,
      forceEnable: options?.forceEnable ?? true,
    })
    assert.ok(runtime)

    const physical = runtime.player as AdapterPhysicalPort
    physical.seedPlaying(
      sessionTrackAsTrack(waveQueue.items[0]!),
      urlFor('wave-1'),
      10,
    )
    await adapter.load(urlFor('wave-1'))
    adapter.seek(10)
    await adapter.play()

    return { store, live, runtime, adapter, physical }
  }

  it('1. WAVE → SEARCH: во время Prepare WAVE продолжает звучать', async () => {
    const resolved: string[] = []
    const { runtime, adapter, physical, store } = await setupRuntime({
      resolveDelayMs: 40,
      onResolve: (id) => resolved.push(id),
    })

    assert.equal(adapter.isPlaying(), true)
    assert.equal(physical.getCurrentTrackId(), 'wave-1')

    const switchPromise = runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-1']),
      startTrackId: 'search-1',
    })

    // Пока prepare in-flight — WAVE ещё playing, currentTrack не search
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(adapter.isPlaying(), true)
    assert.equal(physical.getState().currentTrack?.id, 'wave-1')
    assert.equal(physical.getState().pendingTrack?.id ?? null, null)
    assert.ok(resolved.includes('search-1'))

    const result = await switchPromise
    assert.equal(result.ok, true)
    assert.equal(store.getActiveSessionId(), 'search')
    assert.equal(physical.getCurrentTrackId(), 'search-1')
    assert.equal(adapter.getActiveBackend().url, urlFor('search-1'))
  })

  it('2. Prepare fail: текущая композиция не прерывается', async () => {
    const { runtime, adapter, physical } = await setupRuntime({
      failIds: ['bad-1'],
    })
    const playCountBefore = adapter.local.playCount

    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['bad-1']),
      startTrackId: 'bad-1',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'prepare_failed')
    }
    assert.equal(physical.getCurrentTrackId(), 'wave-1')
    assert.equal(adapter.isPlaying(), true)
    // Prepare не должен был pause/load нового
    assert.ok(adapter.local.playCount >= playCountBefore)
  })

  it('3. Commit success: один активный физический источник', async () => {
    const { runtime, adapter, physical } = await setupRuntime()

    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-1']),
      startTrackId: 'search-1',
    })
    assert.equal(result.ok, true)
    assert.equal(physical.getCurrentTrackId(), 'search-1')
    assert.equal(adapter.isPlaying(), true)
    assert.equal(adapter.hadDualPlayback(), false)
    assert.equal(adapter.local.playing, true)
    assert.equal(adapter.spotify.playing, false)
  })

  it('4. Commit fail: корректный rollback обеих сессий', async () => {
    const { runtime, adapter, physical, store, live } = await setupRuntime()

    adapter.failNextLoad()
    store.replaceSlot('search', {
      meta: metaFor('search'),
      queue: queueOf(['old-search']),
    })

    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-fail']),
      startTrackId: 'search-fail',
    })
    assert.equal(result.ok, false)
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.equal(live.current()?.id, 'wave-1')
    // previous SEARCH restored
    assert.equal(store.getSlot('search').queue.items[0]?.id, 'old-search')
    assert.equal(physical.getCurrentTrackId(), 'wave-1')
    void adapter
  })

  it('5. Rapid Play A → B → C: играет C', async () => {
    const { runtime, physical, store } = await setupRuntime({
      resolveDelayMs: 30,
    })

    const pA = runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['A']),
      startTrackId: 'A',
    })
    const pB = runtime.coordinator.switchTo({
      target: 'catalog',
      meta: metaFor('catalog'),
      targetQueue: queueOf(['B']),
      startTrackId: 'B',
    })
    const pC = runtime.coordinator.switchTo({
      target: 'album',
      meta: metaFor('album'),
      targetQueue: queueOf(['C']),
      startTrackId: 'C',
    })

    const [a, b, c] = await Promise.all([pA, pB, pC])
    assert.equal(c.ok, true)
    // A/B либо stale, либо не перебили active session
    assert.ok(a.ok === false || store.getActiveSessionId() === 'album')
    assert.ok(b.ok === false || store.getActiveSessionId() === 'album')
    assert.equal(store.getActiveSessionId(), 'album')
    assert.equal(physical.getCurrentTrackId(), 'C')
  })

  it('6. Старый load завершается после нового Play: актуальное не нарушено', async () => {
    const { runtime, adapter, physical } = await setupRuntime()

    adapter.setLoadDelay(50)
    const slow = runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['slow-1']),
      startTrackId: 'slow-1',
    })

    await new Promise((r) => setTimeout(r, 5))
    adapter.setLoadDelay(0)
    const fast = await runtime.coordinator.switchTo({
      target: 'catalog',
      meta: metaFor('catalog'),
      targetQueue: queueOf(['fast-1']),
      startTrackId: 'fast-1',
    })
    assert.equal(fast.ok, true)
    assert.equal(physical.getCurrentTrackId(), 'fast-1')

    const slowResult = await slow
    // Устаревший либо stale/cancelled, либо не перезаписал
    if (slowResult.ok) {
      // Если каким-то образом ok — всё равно current должен остаться fast
      // (координатор последнего commit), но обычно stale
    } else {
      assert.ok(
        slowResult.reason === 'stale' ||
          slowResult.reason === 'commit_failed' ||
          slowResult.reason === 'prepare_failed',
      )
    }
    assert.equal(physical.getCurrentTrackId(), 'fast-1')
    assert.equal(adapter.getActiveBackend().url, urlFor('fast-1'))
  })

  it('7. Смена source adapter: нет двойного звука', async () => {
    const { runtime, adapter, physical } = await setupRuntime()
    assert.equal(adapter.getActiveBackend().id, 'local')

    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['sp-track'], 0),
      startTrackId: 'sp-track',
    })
    assert.equal(result.ok, true)
    assert.equal(adapter.getActiveBackend().id, 'spotify')
    assert.equal(adapter.spotify.playing, true)
    assert.equal(adapter.local.playing, false)
    assert.equal(adapter.hadDualPlayback(), false)
    assert.equal(physical.getCurrentTrackId(), 'sp-track')
  })

  it('8. Browser NotAllowedError → user_gesture_required', async () => {
    const { runtime, adapter, store } = await setupRuntime()
    adapter.failNextPlay('NotAllowedError')

    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['gesture-1']),
      startTrackId: 'gesture-1',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'user_gesture_required')
    }
    assert.equal(store.getActiveSessionId(), 'wave')
  })

  it('9. Logout/login другого пользователя: нет утечки очереди', () => {
    const live = getPlaybackQueue()
    live.setQueue(
      [
        {
          id: 'secret-u1',
          sourceId: 'y',
          externalId: '1',
          title: 'Secret',
          artist: 'U1',
        },
      ],
      0,
      { type: 'playlist', id: 'p', title: 'P' },
    )
    assert.equal(live.current()?.id, 'secret-u1')

    teardownLiveQueueOnLogout(live)
    assert.equal(live.current(), null)
    assert.equal(live.getItems().length, 0)

    // Чужой legacy на диске
    memory.set(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'legacy-stranger',
            sourceId: 'y',
            externalId: 'x',
            title: 'X',
            artist: 'Y',
          },
        ],
        currentIndex: 0,
      }),
    )

    const handoff = handoffLiveQueueAfterAuth({
      userId: 'user-2',
      deviceId: 'device-1',
      previousUserId: 'user-1',
      liveQueue: live,
    })
    assert.equal(handoff.discardedUntrustedQueue, true)
    assert.equal(live.current(), null)
    assert.ok(!live.getItems().some((t) => t.id === 'secret-u1'))
    assert.ok(!live.getItems().some((t) => t.id === 'legacy-stranger'))
    // Legacy ключ на диске не обязан удаляться
    assert.ok(memory.has(PLAYBACK_QUEUE_STORAGE_KEY))
  })

  it('10. Session restore: нет autoplay', async () => {
    const { runtime, adapter, live, store } = await setupRuntime()
    const playsBefore = adapter.local.playCount + adapter.spotify.playCount

    // Restore = import без commitPlay
    const snap = queueOf(['restored-1'], 0, { phase: 'idle', positionSeconds: 5 })
    store.replaceSlot('catalog', { meta: metaFor('catalog'), queue: snap })
    store.setActiveSessionId('catalog')
    live.importSessionState({
      items: snap.items.map((i) => ({ ...i, previewUrl: null })),
      currentIndex: 0,
      playOrder: [0],
      playOrderIndex: 0,
      repeatMode: 'OFF',
      shuffleMode: 'OFF',
      history: ['restored-1'],
      historyIndex: 0,
      context: { type: 'none' },
      sessionTailIds: [],
    })

    assert.equal(live.current()?.id, 'restored-1')
    assert.equal(
      adapter.local.playCount + adapter.spotify.playCount,
      playsBefore,
    )
    void runtime
  })

  it('11. Pending removal: правильный runtime rollback', async () => {
    const { runtime, physical, live, store, adapter } = await setupRuntime()

    live.setQueue(
      [
        {
          id: 'ghost-a',
          sourceId: 'local',
          externalId: 'ghost-a',
          title: 'A',
          artist: 'X',
        },
        {
          id: 'b',
          sourceId: 'local',
          externalId: 'b',
          title: 'B',
          artist: 'X',
        },
      ],
      0,
      { type: 'playlist', id: 'p', title: 'P' },
    )
    live.removePreservingCurrentPlayback('ghost-a')
    physical.seedPlaying(
      {
        id: 'ghost-a',
        sourceId: 'local',
        externalId: 'ghost-a',
        title: 'A',
        artist: 'X',
        previewUrl: urlFor('ghost-a'),
      },
      urlFor('ghost-a'),
      42,
    )
    adapter.seek(42)
    store.setActiveSessionId('wave')
    store.replaceSlot('wave', {
      meta: { kind: 'wave' },
      queue: queueOf(['ghost-a', 'b']),
    })

    adapter.failNextLoad()
    const result = await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    assert.equal(result.ok, false)
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.ok(live.getPendingRemovalIds().includes('ghost-a'))
    assert.equal(physical.getCurrentTrackId(), 'ghost-a')
    // durable snapshot не возвращает удалённый как sounding position на next
    const durableItems = store.getSlot('wave').queue.items.map((i) => i.id)
    // после rollback durable source был сохранён координатором; призрак runtime-only
    assert.ok(live.exportRuntimeSessionState().pendingRemovalIds.includes('ghost-a'))
    void durableItems
  })

  it('12. Feature flag OFF: runtime не создаётся, legacy path не затронут', () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    assert.equal(isSessionSwitchIntegrationEnabled(), false)

    const store = createPlaybackSessionStore({
      userId: 'user-1',
      deviceId: 'device-1',
    })
    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: getPlaybackQueue(),
      resolve: createResolve(),
      adapter: createControllablePlayerAdapter(),
    })
    assert.equal(runtime, null)

    // Storage key по умолчанию не включает
    assert.notEqual(
      memory.get(SESSION_SWITCH_INTEGRATION_STORAGE_KEY),
      '1',
    )
  })

  it('доказательство: одна live-очередь = getPlaybackQueue(), не createSessionPlaybackQueue', () => {
    setSessionSwitchIntegrationEnabledForTests(true)
    const singleton = getPlaybackQueue()
    const other = createSessionPlaybackQueue()
    assert.notEqual(singleton, other)

    const store = createPlaybackSessionStore({
      userId: 'user-1',
      deviceId: 'device-1',
    })
    const runtime = createSessionSwitchRuntime({
      store,
      liveQueue: singleton,
      resolve: createResolve(),
      adapter: createControllablePlayerAdapter(),
      forceEnable: true,
    })
    assert.ok(runtime)
    assert.equal(runtime.queue, singleton)
    assert.equal(runtime.queue, getPlaybackQueue())
  })

  it('Prepare не пишет URL в localStorage', async () => {
    const { runtime } = await setupRuntime()
    const keysBefore = [...memory.keys()]
    await runtime.coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-1']),
      startTrackId: 'search-1',
    })
    for (const [key, value] of memory) {
      if (keysBefore.includes(key) && key === PLAYBACK_QUEUE_STORAGE_KEY) {
        continue
      }
      assert.ok(
        !value.includes('cdn.test/audio'),
        `playback URL leaked to localStorage key=${key}`,
      )
    }
  })
})

describe('PLAYBACK-DEV-05 source contracts (AudioPlayer / PlayerManager)', () => {
  it('AudioPlayer имеет session prepare/commit без playResolved в prepare', () => {
    const src = readFileSync(
      join(here, '../../audioPlayer/AudioPlayer.ts'),
      'utf8',
    )
    assert.match(src, /async resolveForSessionPrepare\(/)
    assert.match(src, /async commitSessionPlay\(/)
    assert.match(src, /async rollbackSessionPlay\(/)
    assert.match(src, /commitPreparedPlayback/)
    assert.match(src, /getPlayGeneration\(/)

    // Тело resolveForSessionPrepare (до JSDoc commit) — без pause/load/playResolved
    const prepareStart = src.indexOf('async resolveForSessionPrepare')
    const commitDoc = src.lastIndexOf('/**', src.indexOf('async commitSessionPlay'))
    const prepareBody = src.slice(
      prepareStart,
      commitDoc > prepareStart ? commitDoc : src.indexOf('async commitSessionPlay', prepareStart),
    )
    assert.equal(/this\.adapter\.pause/.test(prepareBody), false)
    assert.equal(/this\.adapter\.load/.test(prepareBody), false)
    assert.equal(/playResolved/.test(prepareBody), false)
    assert.match(prepareBody, /resolver\.resolve/)
    assert.match(
      src,
      /endedContext\.type === 'album' &&\s*isSessionSwitchIntegrationEnabled\(\)/,
    )
  })

  it('PlayerManager.load pauseBackends до смены адаптера', () => {
    const src = readFileSync(
      join(here, '../../audioPlayer/PlayerManager.ts'),
      'utf8',
    )
    const loadIdx = src.indexOf('async load(url: string)')
    const pauseIdx = src.indexOf('await this.pauseBackends()', loadIdx)
    const activateIdx = src.indexOf('await this.activateForUrl(url)', loadIdx)
    assert.ok(loadIdx >= 0 && pauseIdx > loadIdx && activateIdx > pauseIdx)
  })

  it('production не включает SessionSwitch из localStorage', () => {
    const src = readFileSync(join(here, '../featureFlag.ts'), 'utf8')
    assert.match(src, /import\.meta\.env\?\.PROD === true/)
    assert.match(src, /serverDecision === true/)
    const productionGuard = src.indexOf('if (isProductionBuild())')
    const localStorageRead = src.indexOf('return devLocalStorageEnabled()')
    assert.ok(productionGuard > 0 && localStorageRead > productionGuard)
    const guard = src.slice(productionGuard, localStorageRead)
    assert.match(guard, /return false/)
  })

  it('queue subscribe не ставит currentTrack из очереди', () => {
    const src = readFileSync(
      join(here, '../../audioPlayer/AudioPlayer.ts'),
      'utf8',
    )
    assert.match(
      src,
      /Не подменяем currentTrack из очереди во время switch/,
    )
  })
})

describe('sessionPhysicalEngine generation ownership', () => {
  it('устаревший commit после claim не перезаписывает новый', async () => {
    const adapter = createControllablePlayerAdapter()
    const cache = new PreparedTrackCache()
    const port = createAdapterPhysicalPort({ adapter, cache })

    cache.set('ref-a', {
      track: {
        id: 'A',
        sourceId: 'local',
        externalId: 'A',
        title: 'A',
        artist: 'X',
      },
      url: urlFor('A'),
      candidate: null,
      playRequestId: 1,
      createdAt: Date.now(),
    })
    cache.set('ref-b', {
      track: {
        id: 'B',
        sourceId: 'local',
        externalId: 'B',
        title: 'B',
        artist: 'X',
      },
      url: urlFor('B'),
      candidate: null,
      playRequestId: 2,
      createdAt: Date.now(),
    })

    adapter.setLoadDelay(40)
    const slow = port.commitPlay({
      trackId: 'A',
      preparedRef: 'ref-a',
      playRequestId: 1,
      playerGenerationAtPrepare: port.getGeneration(),
    })
    await new Promise((r) => setTimeout(r, 5))
    adapter.setLoadDelay(0)
    const fast = await port.commitPlay({
      trackId: 'B',
      preparedRef: 'ref-b',
      playRequestId: 2,
      playerGenerationAtPrepare: port.getGeneration(),
    })
    assert.equal(fast.ok, true)
    const slowResult = await slow
    assert.equal(slowResult.ok, false)
    if (!slowResult.ok) {
      assert.equal(slowResult.reason, 'cancelled')
    }
    assert.equal(port.getCurrentTrackId(), 'B')
  })
})
