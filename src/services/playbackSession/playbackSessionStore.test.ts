import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  MetaSessionMismatchError,
  createEmptySessionQueueSnapshot,
  createPlaybackSessionStore,
} from './PlaybackSessionStore.ts'
import { sanitizeSessionTrack } from './sanitizeTrack.ts'
import {
  PLAYBACK_SESSION_IDS,
  PLAYBACK_SESSION_SCHEMA_VERSION,
  type SessionQueueSnapshot,
} from './types.ts'

function track(partial: Partial<Track> & Pick<Track, 'id'>): Track {
  return {
    id: partial.id,
    sourceId: partial.sourceId ?? 'yandex',
    externalId: partial.externalId ?? partial.id,
    title: partial.title ?? `Title ${partial.id}`,
    artist: partial.artist ?? 'Artist',
    previewUrl: partial.previewUrl ?? null,
    ...(partial.coverUrl !== undefined ? { coverUrl: partial.coverUrl } : {}),
    ...(partial.album !== undefined ? { album: partial.album } : {}),
    ...(partial.tags !== undefined ? { tags: partial.tags } : {}),
  }
}

function queueWith(
  overrides: Partial<SessionQueueSnapshot> = {},
): SessionQueueSnapshot {
  return {
    ...createEmptySessionQueueSnapshot('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('PlaybackSessionStore S1', () => {
  it('создаёт пять независимых слотов', () => {
    const store = createPlaybackSessionStore({
      userId: 'u1',
      deviceId: 'd1',
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const snap = store.getSnapshot()
    assert.equal(snap.schemaVersion, PLAYBACK_SESSION_SCHEMA_VERSION)
    assert.equal(snap.userId, 'u1')
    assert.equal(snap.deviceId, 'd1')
    assert.equal(snap.activeSessionId, null)
    assert.equal(snap.switchEpoch, 0)
    assert.equal(snap.playRequestId, 0)
    assert.deepEqual(Object.keys(snap.slots).sort(), [...PLAYBACK_SESSION_IDS].sort())
    for (const id of PLAYBACK_SESSION_IDS) {
      const slot = snap.slots[id]!
      assert.equal(slot.id, id)
      assert.equal(slot.meta.kind, id)
      assert.equal(slot.slotGeneration, 0)
      assert.equal(slot.queue.items.length, 0)
      assert.equal(slot.queue.currentIndex, -1)
      assert.deepEqual(slot.queue.history, [])
      assert.equal(slot.queue.historyIndex, -1)
      assert.deepEqual(slot.queue.playOrder, [])
      assert.equal(slot.queue.repeatMode, 'OFF')
      assert.equal(slot.queue.shuffleMode, 'OFF')
    }
  })

  it('изменение одного слота не затрагивает остальные', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    const before = store.getSnapshot()

    store.replaceSlot('wave', {
      meta: { kind: 'wave' },
      queue: queueWith({
        items: [track({ id: 'w1', previewUrl: 'https://secret/stream?token=abc' })],
        currentIndex: 0,
        playOrder: [0],
        playOrderIndex: 0,
        history: ['w1'],
        historyIndex: 0,
        repeatMode: 'ALL',
        shuffleMode: 'ON',
        sessionTailIds: ['w1'],
        positionSeconds: 12.5,
        phase: 'playing',
        context: {
          type: 'radio',
          id: 'my-wave',
          title: 'Моя волна',
          origin: 'recommendations',
        },
        updatedAt: '2026-02-01T00:00:00.000Z',
      }),
    })

    const after = store.getSnapshot()
    assert.equal(after.slots.wave.slotGeneration, 1)
    assert.equal(after.slots.wave.queue.items[0]!.id, 'w1')
    assert.equal(after.slots.wave.queue.repeatMode, 'ALL')
    assert.equal(after.slots.wave.queue.shuffleMode, 'ON')
    assert.deepEqual(after.slots.wave.queue.history, ['w1'])
    assert.equal(after.slots.wave.queue.positionSeconds, 12.5)

    for (const id of PLAYBACK_SESSION_IDS) {
      if (id === 'wave') continue
      assert.deepEqual(after.slots[id], before.slots[id])
    }
  })

  it('снимок очереди сохраняет поля для полного restore (не только items+index)', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('search', {
      meta: {
        kind: 'search',
        query: 'test',
        seedTrackId: 's1',
      },
      queue: queueWith({
        items: [track({ id: 's1' }), track({ id: 's2' })],
        currentIndex: 1,
        playOrder: [1, 0],
        playOrderIndex: 0,
        history: ['s1', 's2'],
        historyIndex: 1,
        repeatMode: 'ONE',
        shuffleMode: 'ON',
        sessionTailIds: ['s2'],
        positionSeconds: 3,
        phase: 'user_paused',
        context: {
          type: 'search-seed',
          query: 'test',
          seedTrackId: 's1',
          hardExcludeHits: [
            { id: 's1', title: 'A', artist: 'B', sourceId: 'yandex' },
          ],
        },
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
    })

    const q = store.getSlot('search').queue
    assert.equal(q.items.length, 2)
    assert.equal(q.currentIndex, 1)
    assert.deepEqual(q.playOrder, [1, 0])
    assert.equal(q.playOrderIndex, 0)
    assert.deepEqual(q.history, ['s1', 's2'])
    assert.equal(q.historyIndex, 1)
    assert.equal(q.repeatMode, 'ONE')
    assert.equal(q.shuffleMode, 'ON')
    assert.deepEqual(q.sessionTailIds, ['s2'])
    assert.equal(q.phase, 'user_paused')
    assert.equal(q.context.type, 'search-seed')
    assert.ok(!('pendingRemovalIds' in q))
  })

  it('отклоняет meta другого kind для слота', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    assert.throws(
      () =>
        store.replaceSlot('catalog', {
          meta: { kind: 'album', albumId: 'a1', title: 'X', phase: 'album' },
          queue: queueWith(),
        }),
      (err: unknown) => err instanceof MetaSessionMismatchError,
    )
    assert.equal(store.getSlot('catalog').meta.kind, 'catalog')
    assert.equal(store.getSlot('catalog').slotGeneration, 0)
  })

  it('strip previewUrl / stream secrets из items', () => {
    const dirty = track({
      id: 't1',
      previewUrl: 'https://cdn.example/stream?auth=SECRET',
      coverUrl: 'https://cdn.example/cover.jpg',
      tags: ['rock'],
    })
    const clean = sanitizeSessionTrack(dirty)
    assert.ok(!('previewUrl' in clean))
    assert.equal(clean.coverUrl, 'https://cdn.example/cover.jpg')
    assert.deepEqual(clean.tags, ['rock'])

    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({ items: [dirty], currentIndex: 0 }),
    })
    const stored = store.getSlot('swipes').queue.items[0]!
    assert.ok(!('previewUrl' in stored))
  })

  it('getSlot / getSnapshot возвращают глубокие копии', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('album', {
      meta: {
        kind: 'album',
        albumId: 'alb1',
        title: 'Album',
        artist: 'Art',
        phase: 'album',
      },
      queue: queueWith({
        items: [track({ id: 'a1', tags: ['x'] })],
        currentIndex: 0,
        playOrder: [0],
        history: ['a1'],
      }),
    })

    const slotA = store.getSlot('album')
    slotA.queue.items[0]!.title = 'mutated'
    slotA.queue.items[0]!.tags!.push('y')
    slotA.queue.history.push('hack')
    slotA.queue.playOrder.push(99)
    slotA.meta = { kind: 'album', albumId: 'hack', title: null, phase: 'related' }

    const slotB = store.getSlot('album')
    assert.equal(slotB.queue.items[0]!.title, 'Title a1')
    assert.deepEqual(slotB.queue.items[0]!.tags, ['x'])
    assert.deepEqual(slotB.queue.history, ['a1'])
    assert.deepEqual(slotB.queue.playOrder, [0])
    assert.equal(
      slotB.meta.kind === 'album' ? slotB.meta.albumId : null,
      'alb1',
    )
  })

  it('разделяет switchEpoch и playRequestId', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    const play1 = store.beginPlayRequest()
    const play2 = store.beginPlayRequest()
    assert.equal(play1, 1)
    assert.equal(play2, 2)
    assert.equal(store.getSwitchEpoch(), 0)

    const epoch1 = store.bumpSwitchEpoch()
    assert.equal(epoch1, 1)
    assert.equal(store.getPlayRequestId(), 2)
    assert.equal(store.getSwitchEpoch(), 1)
  })

  it('saveSlotQueue обновляет queue без смены meta kind', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'sys_swipes', title: 'Свайпы' },
      queue: queueWith({ items: [track({ id: 'c1' })], currentIndex: 0 }),
    })
    const gen1 = store.getSlot('catalog').slotGeneration

    store.saveSlotQueue(
      'catalog',
      queueWith({
        items: [track({ id: 'c1' }), track({ id: 'c2' })],
        currentIndex: 1,
        history: ['c1', 'c2'],
        historyIndex: 1,
        playOrder: [0, 1],
        playOrderIndex: 1,
        positionSeconds: 40,
        phase: 'playing',
        context: { type: 'playlist', id: 'sys_swipes', title: 'Свайпы' },
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
    )

    const slot = store.getSlot('catalog')
    assert.equal(slot.slotGeneration, gen1 + 1)
    assert.equal(slot.meta.kind, 'catalog')
    assert.equal(
      slot.meta.kind === 'catalog' ? slot.meta.catalogId : null,
      'sys_swipes',
    )
    assert.equal(slot.queue.items.length, 2)
    assert.equal(slot.queue.currentIndex, 1)
    assert.deepEqual(slot.queue.history, ['c1', 'c2'])
  })

  it('изоляция по пользователю: rebindUser очищает слоты', () => {
    const store = createPlaybackSessionStore({
      userId: 'alice',
      deviceId: 'phone-1',
    })
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({
        items: [track({ id: 'priv' })],
        currentIndex: 0,
        history: ['priv'],
      }),
    })
    store.setActiveSessionId('swipes')
    const epochBefore = store.getSwitchEpoch()
    const playBefore = store.getPlayRequestId()

    store.rebindUser('bob')

    assert.equal(store.getUserId(), 'bob')
    assert.equal(store.getDeviceId(), 'phone-1')
    assert.equal(store.getActiveSessionId(), null)
    assert.ok(store.getSwitchEpoch() > epochBefore)
    assert.ok(store.getPlayRequestId() > playBefore)
    assert.equal(store.getSlot('swipes').queue.items.length, 0)
    assert.equal(store.getSlot('swipes').slotGeneration, 0)
  })

  it('context none не требует создания активной сессии', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    assert.equal(store.getActiveSessionId(), null)
    store.saveSlotQueue(
      'catalog',
      queueWith({
        context: { type: 'none' },
        phase: 'idle',
      }),
    )
    assert.equal(store.getActiveSessionId(), null)
  })

  it('одна CATALOG-сессия обслуживает разные catalogId поочерёдно', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'my-music', title: 'Моя музыка' },
      queue: queueWith({ items: [track({ id: 'm1' })], currentIndex: 0 }),
    })
    store.replaceSlot('catalog', {
      meta: { kind: 'catalog', catalogId: 'sys_swipes', title: 'Свайпы' },
      queue: queueWith({ items: [track({ id: 'sw1' })], currentIndex: 0 }),
    })
    const slot = store.getSlot('catalog')
    assert.equal(slot.meta.kind === 'catalog' ? slot.meta.catalogId : null, 'sys_swipes')
    assert.equal(slot.queue.items[0]!.id, 'sw1')
    assert.equal(slot.slotGeneration, 2)
  })

  it('R10: rebindDevice очищает слоты (изоляция устройств)', () => {
    const store = createPlaybackSessionStore({
      userId: 'alice',
      deviceId: 'phone-1',
    })
    store.replaceSlot('wave', {
      meta: { kind: 'wave' },
      queue: queueWith({ items: [track({ id: 'w' })], currentIndex: 0 }),
    })
    store.setActiveSessionId('wave')
    store.rebindDevice('tablet-2')
    assert.equal(store.getDeviceId(), 'tablet-2')
    assert.equal(store.getUserId(), 'alice')
    assert.equal(store.getActiveSessionId(), null)
    assert.equal(store.getSlot('wave').queue.items.length, 0)
  })

  it('R10: clearForLogout очищает слоты отдельно от rebindUser', () => {
    const store = createPlaybackSessionStore({
      userId: 'alice',
      deviceId: 'phone-1',
    })
    store.replaceSlot('search', {
      meta: { kind: 'search', query: 'q', seedTrackId: null },
      queue: queueWith({ items: [track({ id: 's' })], currentIndex: 0 }),
    })
    store.clearForLogout()
    assert.equal(store.getUserId(), null)
    assert.equal(store.getSlot('search').queue.items.length, 0)
  })

  it('R10: изоляция входных аргументов replaceSlot', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    const items = [track({ id: 'in1', tags: ['a'] })]
    const history = ['in1']
    const playOrder = [0]
    store.replaceSlot('swipes', {
      meta: { kind: 'swipes' },
      queue: queueWith({
        items,
        currentIndex: 0,
        history,
        playOrder,
        playOrderIndex: 0,
      }),
    })
    items[0]!.title = 'mutated-input'
    items[0]!.tags!.push('b')
    history.push('hack')
    playOrder.push(99)
    const slot = store.getSlot('swipes')
    assert.equal(slot.queue.items[0]!.title, 'Title in1')
    assert.deepEqual(slot.queue.items[0]!.tags, ['a'])
    assert.deepEqual(slot.queue.history, ['in1'])
    assert.deepEqual(slot.queue.playOrder, [0])
  })

  it('R10: мутация hardExcludeHits и sessionTailIds на копии не портит store', () => {
    const store = createPlaybackSessionStore({ deviceId: 'd1' })
    store.replaceSlot('search', {
      meta: { kind: 'search', query: 'q', seedTrackId: 's1' },
      queue: queueWith({
        items: [track({ id: 's1' })],
        currentIndex: 0,
        playOrder: [0],
        sessionTailIds: ['s1'],
        context: {
          type: 'search-seed',
          query: 'q',
          seedTrackId: 's1',
          hardExcludeHits: [
            { id: 's1', title: 'A', artist: 'B', sourceId: 'yandex' },
          ],
        },
      }),
    })
    const copy = store.getSlot('search')
    copy.queue.sessionTailIds.push('hack')
    if (copy.queue.context.type === 'search-seed' && copy.queue.context.hardExcludeHits) {
      copy.queue.context.hardExcludeHits[0]!.title = 'mutated'
      ;(copy.queue.context.hardExcludeHits as { id: string }[]).push({ id: 'x' })
    }
    const again = store.getSlot('search')
    assert.deepEqual(again.queue.sessionTailIds, ['s1'])
    assert.ok(again.queue.context.type === 'search-seed')
    if (again.queue.context.type === 'search-seed') {
      assert.equal(again.queue.context.hardExcludeHits?.[0]?.title, 'A')
      assert.equal(again.queue.context.hardExcludeHits?.length, 1)
    }
  })
})
