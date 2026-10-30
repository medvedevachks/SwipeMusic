/**
 * PLAYBACK-DEV-03A — безопасность legacy persist и pending-removal семантика.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
  createSessionPlaybackQueue,
} from './PlaybackQueue.ts'
import { buildDurableSessionState } from './playbackQueueSessionState.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function t(id: string, extra: Partial<Track> = {}): Track {
  return track({
    sourceId: 'yandex-music',
    externalId: id,
    title: `Title ${id}`,
    artist: 'Artist',
    ...extra,
  })
}

function installMemoryLocalStorage(seed?: Map<string, string>): Map<string, string> {
  const memory = seed ?? new Map<string, string>()
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

describe('PLAYBACK-DEV-03A legacy persistence isolation', () => {
  it('importSessionState не пишет в legacy v1 даже после отложенного persist (fake timers)', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const memory = installMemoryLocalStorage()
      memory.set(
        PLAYBACK_QUEUE_STORAGE_KEY,
        JSON.stringify({
          items: [t('legacy-owner-unknown')],
          currentIndex: 0,
          playOrder: [0],
          playOrderIndex: 0,
          repeatMode: 'OFF',
          shuffleMode: 'OFF',
          history: [],
          historyIndex: -1,
          context: { type: 'swipe' },
          sessionTailIds: [],
        }),
      )
      const beforeLegacy = memory.get(PLAYBACK_QUEUE_STORAGE_KEY)

      const queue = new PlaybackQueue({ persistenceMode: 'legacy' })
      // constructor restore прочитал v1 — это legacy path
      assert.equal(queue.current()?.id, 'yandex-music:legacy-owner-unknown')

      const sessionPayload = {
        items: [t('alice-private'), t('alice-2')],
        currentIndex: 0,
        playOrder: [0, 1],
        playOrderIndex: 0,
        repeatMode: 'ALL' as const,
        shuffleMode: 'OFF' as const,
        history: ['yandex-music:alice-private'],
        historyIndex: 0,
        context: { type: 'library' as const },
        sessionTailIds: [] as string[],
      }

      const result = queue.importSessionState(sessionPayload)
      assert.equal(result.ok, true)
      assert.equal(queue.getPersistenceMode(), 'session')
      assert.equal(queue.current()?.id, 'yandex-music:alice-private')

      // Сразу после import ключ не должен получить alice-данные
      assert.equal(memory.get(PLAYBACK_QUEUE_STORAGE_KEY), beforeLegacy)
      assert.ok(!memory.get(PLAYBACK_QUEUE_STORAGE_KEY)?.includes('alice-private'))

      // Отложенный persist (200ms) — тоже не должен записать
      mock.timers.tick(500)
      assert.equal(memory.get(PLAYBACK_QUEUE_STORAGE_KEY), beforeLegacy)
      assert.ok(!memory.get(PLAYBACK_QUEUE_STORAGE_KEY)?.includes('alice-private'))

      // Последующие мутации после import тоже не пишут в legacy
      queue.next()
      mock.timers.tick(500)
      assert.ok(!memory.get(PLAYBACK_QUEUE_STORAGE_KEY)?.includes('alice-2'))
      assert.equal(memory.get(PLAYBACK_QUEUE_STORAGE_KEY), beforeLegacy)
    } finally {
      mock.timers.reset()
    }
  })

  it('session mode: constructor не поднимает legacy v1 неизвестного владельца', () => {
    const memory = installMemoryLocalStorage()
    memory.set(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        items: [t('stranger')],
        currentIndex: 0,
        playOrder: [0],
        playOrderIndex: 0,
        repeatMode: 'OFF',
        shuffleMode: 'OFF',
        history: ['yandex-music:stranger'],
        historyIndex: 0,
        context: { type: 'swipe' },
        sessionTailIds: [],
      }),
    )

    const sessionQueue = createSessionPlaybackQueue()
    assert.equal(sessionQueue.getPersistenceMode(), 'session')
    assert.equal(sessionQueue.current(), null)
    assert.equal(sessionQueue.getItems().length, 0)
    // ключ не удалён
    assert.ok(memory.get(PLAYBACK_QUEUE_STORAGE_KEY)?.includes('stranger'))
  })

  it('legacy mode production path: setQueue по-прежнему персистит в v1 (без регрессии)', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const memory = installMemoryLocalStorage()
      const queue = new PlaybackQueue({ persistenceMode: 'legacy' })
      queue.setQueue([t('prod')], 0, { type: 'swipe' })
      assert.equal(memory.get(PLAYBACK_QUEUE_STORAGE_KEY), undefined)
      mock.timers.tick(250)
      const raw = memory.get(PLAYBACK_QUEUE_STORAGE_KEY)
      assert.ok(raw)
      assert.ok(raw.includes('prod'))
    } finally {
      mock.timers.reset()
    }
  })

  it('detachLegacyPersistence отменяет уже запланированный persist', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const memory = installMemoryLocalStorage()
      const queue = new PlaybackQueue({ persistenceMode: 'legacy' })
      queue.setQueue([t('should-not-flush')], 0)
      queue.detachLegacyPersistence()
      mock.timers.tick(500)
      assert.equal(memory.get(PLAYBACK_QUEUE_STORAGE_KEY), undefined)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('PLAYBACK-DEV-03A pending removal export consistency', () => {
  it('текущий призрак исключён; current указывает на следующую композицию, не на чужую позицию', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const a = t('a')
    const b = t('b')
    const c = t('c')
    queue.setQueue([a, b, c], 0, { type: 'playlist', id: 'p', title: 'P' })
    queue.removePreservingCurrentPlayback(a.id)

    const exported = queue.exportSessionState()
    assert.deepEqual(
      exported.items.map((item) => item.id),
      ['yandex-music:b', 'yandex-music:c'],
    )
    assert.equal(exported.currentIndex, 0)
    assert.equal(exported.items[exported.currentIndex]!.id, 'yandex-music:b')
    assert.ok(!exported.history.includes('yandex-music:a'))
    assert.ok(exported.playOrder.length === 2)
    assert.equal(exported.playOrder[exported.playOrderIndex], exported.currentIndex)

    // live не тронут экспортом; AudioPlayer не затронут (нет поля audio)
    assert.equal(queue.current()?.id, 'yandex-music:a')
    assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:a'])
    assert.equal(typeof (queue as unknown as { audio?: unknown }).audio, 'undefined')
  })

  it('только pending current → durable пустая очередь (остановка после окончания текущей)', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    queue.setQueue([t('only')], 0, { type: 'playlist', id: 'p', title: 'P' })
    queue.removePreservingCurrentPlayback('yandex-music:only')

    const exported = queue.exportSessionState()
    assert.deepEqual(exported.items, [])
    assert.equal(exported.currentIndex, -1)
    assert.deepEqual(exported.playOrder, [])
    assert.deepEqual(exported.history, [])

    // live ещё держит призрак до Next/ended — физический плеер снаружи
    assert.equal(queue.current()?.id, 'yandex-music:only')
  })

  it('buildDurableSessionState не мутирует входные массивы', () => {
    const items = [t('a'), t('b')]
    const playOrder = [0, 1]
    const history = ['yandex-music:a']
    const pending = new Set(['yandex-music:a'])
    const snapshot = buildDurableSessionState({
      items,
      currentIndex: 0,
      playOrder,
      playOrderIndex: 0,
      repeatMode: 'OFF',
      shuffleMode: 'OFF',
      history,
      historyIndex: 0,
      context: { type: 'none' },
      sessionTailIds: [],
      pendingRemovalIds: pending,
    })
    assert.equal(items.length, 2)
    assert.equal(history.length, 1)
    assert.equal(snapshot.items[0]!.id, 'yandex-music:b')
  })
})

describe('PLAYBACK-DEV-03A duplicate track id Previous/Next semantics', () => {
  it('KNOWN DEFECT: previous() якорится на первое вхождение id, не на occurrence rank', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue({ persistenceMode: 'session' })
    const same = t('same')
    const mid = t('mid')
    // [same#0, mid, same#1] — два вхождения одного id
    queue.setQueue([same, mid, { ...same }], 0)
    queue.focusTrack('yandex-music:same') // первое
    // Перейти на третье вхождение вручную через next дважды при OFF shuffle
    queue.next() // mid
    queue.next() // same#1 (index 2)
    assert.equal(queue.getSnapshot().currentIndex, 2)

    queue.previous() // history → mid
    assert.equal(queue.current()?.id, 'yandex-music:mid')
    queue.previous() // history → same, но findIndex → index 0, не 2
    assert.equal(queue.current()?.id, 'yandex-music:same')
    // Фактическая семантика (дефект): возвращаемся к первому вхождению.
    assert.equal(
      queue.getSnapshot().currentIndex,
      0,
      'BUG: history id resolves via findIndex → first occurrence (needs PLAYBACK-BUG-dup-history-anchor)',
    )
  })
})
