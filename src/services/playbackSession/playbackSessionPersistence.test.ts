import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PLAYBACK_QUEUE_STORAGE_KEY } from '../playbackQueue/PlaybackQueue.ts'
import {
  createEmptySessionQueueSnapshot,
  createPlaybackSessionStore,
} from './PlaybackSessionStore.ts'
import {
  createPlaybackSessionPersistence,
  PersistenceWriteError,
  sessionsMetaStorageKey,
  sessionsSlotStorageKey,
} from './persistence.ts'
import { createMemoryStorage } from './memoryStorage.ts'
import { sanitizeCoverUrl, toSessionTrack } from './sanitizeTrack.ts'
import { PLAYBACK_SESSION_IDS, type SessionQueueSnapshot } from './types.ts'
import { validateSessionQueueSnapshot } from './validate.ts'
import { refuseLegacyV1Import } from './legacyV1.ts'

function track(id: string, extra: Record<string, unknown> = {}) {
  return toSessionTrack({
    id,
    sourceId: 'yandex',
    externalId: id,
    title: `Title ${id}`,
    artist: 'Artist',
    ...extra,
  })
}

function queueWith(
  overrides: Partial<SessionQueueSnapshot> = {},
): SessionQueueSnapshot {
  return {
    ...createEmptySessionQueueSnapshot('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('PlaybackSessionPersistence DEV-02', () => {
  it('persist и restore пяти независимых слотов без автозапуска аудио', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({
      userId: 'user-a',
      deviceId: 'device-1',
    })

    for (const id of PLAYBACK_SESSION_IDS) {
      store.replaceSlot(id, {
        meta:
          id === 'search'
            ? { kind: 'search', query: 'q', seedTrackId: null }
            : id === 'catalog'
              ? { kind: 'catalog', catalogId: 'c1', title: 'C' }
              : id === 'album'
                ? { kind: 'album', albumId: 'a1', title: 'A', phase: 'album' }
                : { kind: id },
        queue: queueWith({
          items: [track(`${id}-t`)],
          currentIndex: 0,
          playOrder: [0],
          playOrderIndex: 0,
          history: [`${id}-t`],
          historyIndex: 0,
          phase: 'playing',
          positionSeconds: 9,
        }),
      })
    }
    store.setActiveSessionId('wave')
    store.bumpSwitchEpoch()
    store.beginPlayRequest()

    persist.saveSnapshot(store.getSnapshot())

    const store2 = createPlaybackSessionStore({
      userId: 'user-a',
      deviceId: 'device-1',
    })
    const loaded = persist.load('user-a', 'device-1')
    assert.equal(loaded.audioAutoplay, false)
    const hydrate = store2.hydrateFromLoadResult(loaded)
    assert.equal(hydrate.audioAutoplay, false)

    for (const id of PLAYBACK_SESSION_IDS) {
      assert.equal(store2.getSlot(id).queue.items[0]?.id, `${id}-t`)
      assert.equal(store2.getSlot(id).queue.phase, 'playing')
    }
    assert.equal(store2.getActiveSessionId(), 'wave')
    assert.equal(store2.getSwitchEpoch(), 1)
    assert.equal(store2.getPlayRequestId(), 1)
  })

  it('изоляция двух пользователей: чужой снимок не загружается', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const alice = createPlaybackSessionStore({
      userId: 'alice',
      deviceId: 'device-1',
    })
    alice.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({
        items: [track('alice-only')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    persist.saveSnapshot(alice.getSnapshot())

    const bobLoad = persist.load('bob', 'device-1')
    for (const id of PLAYBACK_SESSION_IDS) {
      assert.equal(bobLoad.slots[id].status, 'missing')
    }

    // Подмена userId в ключе alice недоступна bob-ключу
    assert.equal(
      storage.getItem(sessionsSlotStorageKey('bob', 'device-1', 'swipes')),
      null,
    )
    assert.ok(
      storage.getItem(sessionsSlotStorageKey('alice', 'device-1', 'swipes')),
    )
  })

  it('изоляция устройств: данные phone не видны tablet', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const phone = createPlaybackSessionStore({
      userId: 'alice',
      deviceId: 'phone',
    })
    phone.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'x', title: 'X' },
      queue: queueWith({
        items: [track('phone-track')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    persist.saveSnapshot(phone.getSnapshot())

    const tabletLoad = persist.load('alice', 'tablet')
    assert.equal(tabletLoad.slots.catalog.status, 'missing')
  })

  it('повреждённый JSON одного слота не уничтожает остальные', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({
      userId: 'u1',
      deviceId: 'd1',
    })
    store.replaceSlot('wave', {
      meta: { kind: 'wave' },
      queue: queueWith({
        items: [track('ok')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    store.replaceSlot('search', {
      meta: { kind: 'search', query: null, seedTrackId: null },
      queue: queueWith({
        items: [track('search-ok')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    persist.saveSnapshot(store.getSnapshot())

    storage.setItem(
      sessionsSlotStorageKey('u1', 'd1', 'wave'),
      '{not-json',
    )

    const loaded = persist.load('u1', 'd1')
    assert.equal(loaded.slots.wave.status, 'corrupt')
    assert.equal(loaded.slots.search.status, 'ok')
    if (loaded.slots.search.status === 'ok') {
      assert.equal(loaded.slots.search.slot.queue.items[0]?.id, 'search-ok')
    }
  })

  it('некорректные индексы и метаданные отклоняются валидатором', () => {
    const bad = validateSessionQueueSnapshot({
      items: [track('t1')],
      currentIndex: 5,
      playOrder: [0, 9],
      playOrderIndex: 0,
      repeatMode: 'NOPE',
      shuffleMode: 'OFF',
      history: ['t1'],
      historyIndex: 3,
      context: { type: 'none' },
      sessionTailIds: ['t1'],
      positionSeconds: -1,
      phase: 'playing',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pendingRemovalIds: ['t1'],
    })
    assert.equal(bad.ok, false)
    if (!bad.ok) {
      const paths = bad.issues.map((i) => i.path)
      assert.ok(paths.some((p) => p.includes('currentIndex')))
      assert.ok(paths.some((p) => p.includes('playOrder')))
      assert.ok(paths.some((p) => p.includes('historyIndex')))
      assert.ok(paths.some((p) => p.includes('repeatMode')))
      assert.ok(paths.some((p) => p.includes('positionSeconds')))
      assert.ok(paths.some((p) => p.includes('pendingRemovalIds')))
    }
  })

  it('невозможность сохранения секретных URL в SessionTrack / cover policy', () => {
    const withPreview = toSessionTrack({
      id: 't',
      sourceId: 'y',
      externalId: 't',
      title: 'T',
      artist: 'A',
      previewUrl: 'https://cdn/stream?token=SECRET',
      coverUrl: 'https://cdn/cover.jpg?token=SIGNED',
    } as never)
    assert.ok(!('previewUrl' in withPreview))
    assert.equal(withPreview.coverUrl, null)

    const safeCover = sanitizeCoverUrl('https://cdn.example/img.jpg?w=300&h=300')
    assert.equal(safeCover.ok, true)
    assert.ok(safeCover.coverUrl?.includes('w=300'))

    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({ userId: 'u1', deviceId: 'd1' })
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({
        items: [
          toSessionTrack({
            id: 't',
            sourceId: 'y',
            externalId: 't',
            title: 'T',
            artist: 'A',
            previewUrl: 'https://secret',
          } as never),
        ],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    persist.saveSnapshot(store.getSnapshot())
    const raw = storage.getItem(sessionsSlotStorageKey('u1', 'd1', 'swipes'))!
    assert.ok(!raw.includes('https://secret'))
    assert.ok(!raw.includes('previewUrl'))
  })

  it('legacy v1 без подтверждённого владельца не импортируется и не удаляется', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        items: [{ id: 'legacy', title: 'L', artist: 'A', sourceId: 'y', externalId: '1' }],
        currentIndex: 0,
        playOrder: [0],
        playOrderIndex: 0,
        repeatMode: 'OFF',
        shuffleMode: 'OFF',
        history: [],
        historyIndex: -1,
        context: { type: 'swipe' },
        sessionTailIds: ['legacy'],
        pendingRemovalIds: [],
      }),
    )

    const refused = refuseLegacyV1Import(storage)
    assert.equal(refused.imported, false)
    assert.equal(refused.inspection.present, true)
    assert.equal(refused.inspection.eligibleForAutoImport, false)
    assert.equal(refused.inspection.hasSessionTailIdsField, true)
    assert.equal(refused.inspection.hasPendingRemovalIdsField, true)

    const persist = createPlaybackSessionPersistence({ storage })
    const loaded = persist.load('confirmed-user', 'd1')
    for (const id of PLAYBACK_SESSION_IDS) {
      assert.equal(loaded.slots[id].status, 'missing')
    }
    assert.equal(loaded.audioAutoplay, false)
    assert.ok(storage.getItem(PLAYBACK_QUEUE_STORAGE_KEY), 'legacy key preserved')
  })

  it('ошибка записи / quota не затирает действующие данные ключа', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({ userId: 'u1', deviceId: 'd1' })
    store.replaceSlot('album', {
      meta: { kind: 'album', albumId: 'a', title: 'A', phase: 'album' },
      queue: queueWith({
        items: [track('keep-me')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    persist.saveSnapshot(store.getSnapshot())
    const key = sessionsSlotStorageKey('u1', 'd1', 'album')
    const before = storage.getItem(key)
    assert.ok(before)

    storage.failNextSetItem = new DOMException(
      'QuotaExceededError',
      'QuotaExceededError',
    )
    store.replaceSlot('album', {
      meta: { kind: 'album', albumId: 'a', title: 'A', phase: 'album' },
      queue: queueWith({
        items: [track('new')],
        currentIndex: 0,
        playOrder: [0],
      }),
    })
    assert.throws(
      () => persist.saveSlot('u1', 'd1', store.getSlot('album')),
      (err: unknown) =>
        err instanceof PersistenceWriteError && err.code === 'quota',
    )
    assert.equal(storage.getItem(key), before)
  })

  it('size_limit отказывает в записи без усечения очереди', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({
      storage,
      maxBytesPerKey: 200,
    })
    const store = createPlaybackSessionStore({ userId: 'u1', deviceId: 'd1' })
    const items = Array.from({ length: 40 }, (_, i) =>
      track(`long-${i}`, { title: `Very long title ${i} `.repeat(5) }),
    )
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({
        items,
        currentIndex: 0,
        playOrder: items.map((_, i) => i),
        playOrderIndex: 0,
        history: items.map((t) => t.id),
        historyIndex: 0,
      }),
    })
    assert.throws(
      () => persist.saveSlot('u1', 'd1', store.getSlot('swipes')),
      (err: unknown) =>
        err instanceof PersistenceWriteError && err.code === 'size_limit',
    )
    assert.equal(
      storage.getItem(sessionsSlotStorageKey('u1', 'd1', 'swipes')),
      null,
    )
  })

  it('logout clearUserDevice удаляет только ключи user+device, legacy остаётся', () => {
    const storage = createMemoryStorage()
    storage.setItem(PLAYBACK_QUEUE_STORAGE_KEY, '{"items":[]}')
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({ userId: 'u1', deviceId: 'd1' })
    store.replaceSlot('wave', {
      meta: { kind: 'wave' },
      queue: queueWith({ items: [track('w')], currentIndex: 0, playOrder: [0] }),
    })
    persist.saveSnapshot(store.getSnapshot())
    persist.clearUserDevice('u1', 'd1')
    assert.equal(storage.getItem(sessionsMetaStorageKey('u1', 'd1')), null)
    assert.equal(storage.getItem(sessionsSlotStorageKey('u1', 'd1', 'wave')), null)
    assert.ok(storage.getItem(PLAYBACK_QUEUE_STORAGE_KEY))
  })

  it('unconfirmed userId нельзя персистить', () => {
    const storage = createMemoryStorage()
    const persist = createPlaybackSessionPersistence({ storage })
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith(),
    })
    assert.throws(
      () => persist.saveSnapshot(store.getSnapshot()),
      (err: unknown) =>
        err instanceof PersistenceWriteError && err.code === 'unconfirmed_user',
    )
  })
})
