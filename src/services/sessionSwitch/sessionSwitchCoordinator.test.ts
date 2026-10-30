import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createEmptySessionQueueSnapshot,
  createPlaybackSessionStore,
} from '../playbackSession/PlaybackSessionStore.ts'
import { toSessionTrack } from '../playbackSession/sanitizeTrack.ts'
import type {
  PlaybackSessionId,
  SessionQueueSnapshot,
  SessionSlotMeta,
} from '../playbackSession/types.ts'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
} from '../playbackQueue/PlaybackQueue.ts'
import { createSessionSwitchCoordinator } from './SessionSwitchCoordinator.ts'
import {
  PLAYBACK_BUG_01,
  prepareExistingLiveQueueForSessionMode,
} from './migrateLiveQueue.ts'
import { playbackExportToSessionQueue } from './queueSnapshotBridge.ts'
import {
  createFakePersistPort,
  createFakePlayerPort,
  createFakePreparePort,
  wrapQueuePort,
} from './testDoubles.ts'

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
    },
  })
  return memory
}

function track(id: string) {
  return toSessionTrack({
    id,
    sourceId: 'yandex',
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
  const items = ids.map(track)
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

function setup(options?: {
  prepareDelayMs?: number
  prepareFail?: boolean
  commitFail?: Parameters<typeof createFakePlayerPort>[0] extends infer O
    ? O extends { commitFail?: infer C }
      ? C
      : never
    : never
}) {
  installMemoryLocalStorage()
  const store = createPlaybackSessionStore({
    userId: 'user-1',
    deviceId: 'device-1',
  })
  const queue = new PlaybackQueue({ persistenceMode: 'session' })
  const waveQueue = queueOf(['wave-1', 'wave-2'], 0, {
    context: { type: 'radio', id: 'my-wave', title: 'W', origin: 'recommendations' },
    positionSeconds: 10,
  })
  store.replaceSlot('wave', { meta: { kind: 'wave' }, queue: waveQueue })
  store.setActiveSessionId('wave')
  queue.importSessionState({
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

  const prepare = createFakePreparePort({
    delayMs: options?.prepareDelayMs,
    fail: options?.prepareFail,
  })
  const player = createFakePlayerPort({
    initialTrackId: 'wave-1',
    initialPosition: 12.5,
    commitFail: options?.commitFail,
  })
  const persist = createFakePersistPort()
  const coordinator = createSessionSwitchCoordinator({
    store,
    queue: wrapQueuePort(queue),
    player,
    prepare,
    persist,
  })
  return { store, queue, prepare, player, persist, coordinator }
}

describe('SessionSwitchCoordinator DEV-04', () => {
  it('WAVE → SEARCH: Prepare не останавливает старую музыку (нет pause до Commit)', async () => {
    const { coordinator, player, prepare, store } = setup({ prepareDelayMs: 20 })
    const pauseBefore = player.pauseCount
    const playingBefore = player.getCurrentTrackId()

    const pending = coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-1'], 0, {
        context: { type: 'search', query: 'q' },
      }),
      startTrackId: 'search-1',
    })

    // Во время prepare старый трек ещё «играет»
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(player.getCurrentTrackId(), playingBefore)
    assert.equal(player.pauseCount, pauseBefore)
    assert.equal(player.commitCount, 0)
    assert.ok(prepare.prepareCount >= 1)

    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(store.getActiveSessionId(), 'search')
    assert.equal(player.getCurrentTrackId(), 'search-1')
    // pause/stop только на физическом commit-пути фейка не эмулируется как pauseCount;
    // главное — prepare не увеличил pauseCount
    assert.equal(player.pausedDuringPrepare, false)
  })

  it('Prepare fail: старая сессия и очередь неизменны', async () => {
    const { coordinator, store, queue, player } = setup({ prepareFail: true })
    const before = store.getSlot('wave').queue.items.map((i) => i.id)
    const result = await coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['search-1']),
      startTrackId: 'search-1',
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'prepare_failed')
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.deepEqual(
      store.getSlot('wave').queue.items.map((i) => i.id),
      before,
    )
    assert.equal(queue.current()?.id, 'wave-1')
    assert.equal(player.getCurrentTrackId(), 'wave-1')
    assert.equal(player.commitCount, 0)
  })

  it('Commit success: активна только целевая сессия', async () => {
    const { coordinator, store } = setup()
    const result = await coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    assert.equal(result.ok, true)
    assert.equal(store.getActiveSessionId(), 'search')
    assert.ok(store.getSlot('wave').queue.items.length > 0)
    assert.equal(store.getSlot('search').queue.items[0]?.id, 's1')
  })

  it('Commit fail: логическое состояние откатывается', async () => {
    const { coordinator, store, queue, player } = setup({
      commitFail: { ok: false, reason: 'load_failed', message: 'load' },
    })
    const result = await coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    assert.equal(result.ok, false)
    assert.equal(store.getActiveSessionId(), 'wave')
    assert.equal(queue.current()?.id, 'wave-1')
    assert.equal(player.rollbackCount, 1)
  })

  it('user_gesture_required не маскируется под успех', async () => {
    const { coordinator } = setup({
      commitFail: { ok: false, reason: 'user_gesture_required' },
    })
    const result = await coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.reason, 'user_gesture_required')
      assert.equal(result.phase, 'user_gesture_required')
    }
  })

  it('старый rollback не отменяет более новый успешный Play', async () => {
    const { coordinator, store, player } = setup({ prepareDelayMs: 40 })
    const slow = coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['slow']),
      startTrackId: 'slow',
    })
    await new Promise((r) => setTimeout(r, 5))
    const fast = await coordinator.switchTo({
      target: 'catalog',
      meta: { kind: 'catalog', catalogId: 'x', title: 'X' },
      targetQueue: queueOf(['fast']),
      startTrackId: 'fast',
    })
    assert.equal(fast.ok, true)
    assert.equal(store.getActiveSessionId(), 'catalog')

    const slowResult = await slow
    assert.equal(slowResult.ok, false)
    if (!slowResult.ok) assert.equal(slowResult.reason, 'stale')
    // Новый play не откатили
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.equal(player.getCurrentTrackId(), 'fast')
  })

  it('Rapid Play A → B → C: активируется только C', async () => {
    const { coordinator, store, player } = setup({ prepareDelayMs: 30 })
    const a = coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['A']),
      startTrackId: 'A',
    })
    await new Promise((r) => setTimeout(r, 5))
    const b = coordinator.switchTo({
      target: 'swipes',
      meta: metaFor('swipes'),
      targetQueue: queueOf(['B']),
      startTrackId: 'B',
    })
    await new Promise((r) => setTimeout(r, 5))
    const c = coordinator.switchTo({
      target: 'catalog',
      meta: { kind: 'catalog', catalogId: 'c', title: 'C' },
      targetQueue: queueOf(['C']),
      startTrackId: 'C',
    })
    const [ra, rb, rc] = await Promise.all([a, b, c])
    assert.equal(rc.ok, true)
    assert.equal(ra.ok, false)
    assert.equal(rb.ok, false)
    assert.equal(store.getActiveSessionId(), 'catalog')
    assert.equal(player.getCurrentTrackId(), 'C')
  })

  it('Каталог A → B: заменяется только CATALOG', async () => {
    const { coordinator, store } = setup()
    store.replaceSlot('album', {
      meta: { kind: 'album', albumId: 'keep', title: 'Keep', phase: 'album' },
      queue: queueOf(['album-keep']),
    })
    await coordinator.switchTo({
      target: 'catalog',
      meta: { kind: 'catalog', catalogId: 'A', title: 'A' },
      targetQueue: queueOf(['cat-A']),
      startTrackId: 'cat-A',
    })
    const albumBefore = store.getSlot('album').queue.items[0]?.id
    await coordinator.switchTo({
      target: 'catalog',
      meta: { kind: 'catalog', catalogId: 'B', title: 'B' },
      targetQueue: queueOf(['cat-B']),
      startTrackId: 'cat-B',
    })
    assert.equal(store.getSlot('catalog').meta.kind === 'catalog'
      ? store.getSlot('catalog').meta.catalogId
      : null, 'B')
    assert.equal(store.getSlot('catalog').queue.items[0]?.id, 'cat-B')
    assert.equal(store.getSlot('album').queue.items[0]?.id, albumBefore)
  })

  it('Альбом A → B: заменяется только ALBUM', async () => {
    const { coordinator, store } = setup()
    store.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'keep', title: 'K' },
      queue: queueOf(['cat-keep']),
    })
    await coordinator.switchTo({
      target: 'album',
      meta: { kind: 'album', albumId: 'A', title: 'A', phase: 'album' },
      targetQueue: queueOf(['alb-A']),
      startTrackId: 'alb-A',
    })
    await coordinator.switchTo({
      target: 'album',
      meta: { kind: 'album', albumId: 'B', title: 'B', phase: 'album' },
      targetQueue: queueOf(['alb-B']),
      startTrackId: 'alb-B',
    })
    assert.equal(
      store.getSlot('album').meta.kind === 'album'
        ? store.getSlot('album').meta.albumId
        : null,
      'B',
    )
    assert.equal(store.getSlot('catalog').queue.items[0]?.id, 'cat-keep')
  })

  it('R8: обновление позиции во время Prepare не инвалидирует target slotGeneration', async () => {
    const { coordinator, store } = setup({ prepareDelayMs: 40 })
    const targetGen = store.getSlot('search').slotGeneration
    const switchPromise = coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    await new Promise((r) => setTimeout(r, 5))
    // Позиция активной wave-сессии — без bump generation целевого search
    store.saveSlotRuntime('wave', { positionSeconds: 33, phase: 'playing' })
    assert.equal(store.getSlot('search').slotGeneration, targetGen)
    assert.equal(store.getSlot('wave').slotGeneration, 1) // replaceSlot в setup = 1, runtime без bump
    const result = await switchPromise
    assert.equal(result.ok, true)
  })

  it('Pending removal: позиция призрака не переносится на следующий durable трек', () => {
    const exported = {
      items: [track('b'), track('c')],
      currentIndex: 0,
      playOrder: [0, 1],
      playOrderIndex: 0,
      repeatMode: 'OFF' as const,
      shuffleMode: 'OFF' as const,
      history: ['b'],
      historyIndex: 0,
      context: { type: 'playlist' as const, id: 'p', title: 'P' },
      sessionTailIds: [] as string[],
    }
    const snap = playbackExportToSessionQueue(exported, {
      positionSeconds: 42,
      playingTrackId: 'a',
      pendingRemovalIds: ['a'],
      phase: 'playing',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(snap.items[0]?.id, 'b')
    assert.equal(snap.positionSeconds, 0)
  })

  it('Logout инвалидирует незавершённые операции', async () => {
    const { coordinator, store } = setup({ prepareDelayMs: 50 })
    const pending = coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    await new Promise((r) => setTimeout(r, 5))
    store.clearForLogout()
    coordinator.invalidatePending('logout')
    const result = await pending
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.reason === 'stale' || result.reason === 'logged_out')
    }
  })

  it('операции не пишут пользовательские сессии в legacy v1', async () => {
    const memory = installMemoryLocalStorage()
    memory.set(PLAYBACK_QUEUE_STORAGE_KEY, JSON.stringify({ items: [] }))
    const { coordinator, queue, persist } = setup()
    await coordinator.switchTo({
      target: 'search',
      meta: metaFor('search'),
      targetQueue: queueOf(['s1']),
      startTrackId: 's1',
    })
    assert.equal(queue.getPersistenceMode(), 'session')
    assert.equal(persist.writesLegacyV1, false)
    assert.equal(persist.legacyWrites, 0)
    const legacy = memory.get(PLAYBACK_QUEUE_STORAGE_KEY)
    assert.ok(legacy)
    assert.ok(!legacy.includes('s1'))
  })

  it('UI navigation не инициирует переключение музыки', async () => {
    const { coordinator, store } = setup()
    const before = store.getActiveSessionId()
    coordinator.onUiNavigation('/library')
    coordinator.onUiNavigation('/home')
    assert.equal(coordinator.getUiNavigationCount(), 2)
    assert.equal(store.getActiveSessionId(), before)
  })

  it('prepareExistingLiveQueueForSessionMode переводит singleton-совместимый экземпляр без второй очереди', () => {
    installMemoryLocalStorage()
    const live = new PlaybackQueue({ persistenceMode: 'legacy' })
    live.setQueue(
      [
        {
          id: 'x',
          sourceId: 'y',
          externalId: 'x',
          title: 'X',
          artist: 'A',
        },
      ],
      0,
    )
    const result = prepareExistingLiveQueueForSessionMode(live)
    assert.equal(result.persistenceMode, 'session')
    assert.equal(live.getPersistenceMode(), 'session')
    assert.equal(live.current()?.id, 'x')
  })

  it('фиксирует PLAYBACK-BUG-01 как отдельный дефект', () => {
    assert.ok(PLAYBACK_BUG_01.includes('PLAYBACK-BUG-01'))
  })
})
