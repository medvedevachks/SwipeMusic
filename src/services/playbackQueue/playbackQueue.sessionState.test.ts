import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
  type PlaybackQueueSessionState,
} from './PlaybackQueue.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

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

function t(id: string, extra: Partial<Track> = {}): Track {
  return track({
    sourceId: 'yandex-music',
    externalId: id,
    title: `Title ${id}`,
    artist: 'Artist',
    ...extra,
  })
}

describe('PlaybackQueue session state DEV-03', () => {
  it('полный round-trip export → import сохраняет порядок, shuffle, repeat, history, tail', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    const a = t('a')
    const b = t('b')
    const c = t('c')
    queue.setQueue([a, b, c], 0, { type: 'swipe' })
    queue.setShuffleMode('ON')
    queue.setRepeatMode('ALL')
    // продвигаем историю
    queue.next()
    queue.next()
    queue.previous()
    const exported = queue.exportSessionState()

    assert.equal(exported.shuffleMode, 'ON')
    assert.equal(exported.repeatMode, 'ALL')
    assert.ok(exported.history.length >= 2)
    assert.ok(exported.historyIndex >= 0)
    assert.equal(exported.playOrder.length, 3)
    assert.ok(!('pendingRemovalIds' in exported))

    const other = new PlaybackQueue()
    other.setQueue([t('z')], 0, { type: 'library' })
    const result = other.importSessionState(exported)
    assert.equal(result.ok, true)

    assert.deepEqual(
      other.getItems().map((item) => item.id),
      exported.items.map((item) => item.id),
    )
    assert.deepEqual(other.getSnapshot().playOrder, exported.playOrder)
    assert.equal(other.getSnapshot().playOrderIndex, exported.playOrderIndex)
    assert.equal(other.getSnapshot().currentIndex, exported.currentIndex)
    assert.equal(other.getRepeatMode(), 'ALL')
    assert.equal(other.getShuffleMode(), 'ON')
    assert.deepEqual(other.getSnapshot().history, exported.history)
    assert.equal(other.getSnapshot().historyIndex, exported.historyIndex)
    assert.equal(other.getPlaybackContext().type, 'swipe')

    // Previous/Next после импорта
    const beforePrev = other.current()?.id
    other.previous()
    const afterPrev = other.current()?.id
    assert.ok(beforePrev)
    assert.ok(afterPrev)
  })

  it('независимо сохраняет shuffle и repeat', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.setQueue([t('1'), t('2'), t('3')], 1)
    queue.setShuffleMode('ON')
    queue.setRepeatMode('ONE')
    const order = [...queue.getSnapshot().playOrder]
    const state = queue.exportSessionState()

    const restored = new PlaybackQueue()
    restored.importSessionState(state)
    assert.equal(restored.getShuffleMode(), 'ON')
    assert.equal(restored.getRepeatMode(), 'ONE')
    assert.deepEqual(restored.getSnapshot().playOrder, order)
    assert.equal(restored.getSnapshot().currentIndex, 1)
  })

  it('сохраняет Previous/Next history курсор', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.setQueue([t('a'), t('b'), t('c')], 0)
    queue.next() // b
    queue.next() // c
    queue.previous() // b, historyIndex mid
    const snap = queue.exportSessionState()
    assert.ok(snap.historyIndex < snap.history.length - 1 || snap.history.length >= 2)

    const restored = new PlaybackQueue()
    restored.importSessionState(snap)
    assert.equal(restored.current()?.id, queue.current()?.id)
    assert.equal(restored.getSnapshot().historyIndex, snap.historyIndex)
    restored.next()
    assert.equal(restored.current()?.id, snap.history[snap.historyIndex + 1] ?? restored.current()?.id)
  })

  it('search continuation и sessionTailIds', () => {
    installMemoryLocalStorage()
    const seed = t('seed')
    const rec = t('rec')
    const queue = new PlaybackQueue()
    queue.setQueue([seed], 0, {
      type: 'search-seed',
      query: 'q',
      seedTrackId: seed.id,
    })
    queue.insertNext(rec)
    const state = queue.exportSessionState()
    assert.deepEqual(state.sessionTailIds, [rec.id])
    assert.equal(state.context.type, 'search-seed')

    const restored = new PlaybackQueue()
    restored.importSessionState(state)
    assert.deepEqual(restored.getSessionTailIds(), [rec.id])
    assert.equal(restored.peekNext()?.id, rec.id)
  })

  it('pending removal: durable export не возвращает призрак в будущую очередь', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    const a = t('a')
    const b = t('b')
    queue.setQueue([a, b], 0, { type: 'playlist', id: 'p1', title: 'P' })
    queue.removePreservingCurrentPlayback(a.id)
    assert.deepEqual(queue.getPendingRemovalIds(), [a.id])
    assert.equal(queue.current()?.id, a.id)

    const exported = queue.exportSessionState()
    assert.ok(!exported.items.some((item) => item.id === a.id))
    assert.ok(exported.items.some((item) => item.id === b.id))
    assert.ok(!('pendingRemovalIds' in exported))

    // live очередь не изменена экспортом
    assert.equal(queue.current()?.id, a.id)
    assert.deepEqual(queue.getPendingRemovalIds(), [a.id])

    const restored = new PlaybackQueue()
    restored.importSessionState(exported)
    assert.equal(restored.getPendingRemovalIds().length, 0)
    assert.ok(!restored.getItems().some((item) => item.id === a.id))
    assert.equal(restored.current()?.id, b.id)
  })

  it('повторяющиеся track ID сохраняют индексы playOrder', () => {
    installMemoryLocalStorage()
    const dup = t('same')
    const other = t('other')
    // два вхождения одного id
    const queue = new PlaybackQueue()
    queue.setQueue([dup, other, { ...dup }], 2)
    queue.setShuffleMode('OFF')
    const state = queue.exportSessionState()
    assert.equal(state.items.length, 3)
    assert.equal(state.items[0]!.id, state.items[2]!.id)
    assert.equal(state.currentIndex, 2)

    const restored = new PlaybackQueue()
    restored.importSessionState(state)
    assert.equal(restored.getSnapshot().currentIndex, 2)
    assert.equal(restored.getItems()[0]!.id, restored.getItems()[2]!.id)
    assert.deepEqual(restored.getSnapshot().playOrder, state.playOrder)
  })

  it('пустая очередь', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.clear()
    const state = queue.exportSessionState()
    assert.deepEqual(state.items, [])
    assert.equal(state.currentIndex, -1)
    assert.deepEqual(state.playOrder, [])
    assert.equal(state.playOrderIndex, -1)
    assert.deepEqual(state.sessionTailIds, [])

    const other = new PlaybackQueue()
    other.setQueue([t('x')], 0)
    const result = other.importSessionState(state)
    assert.equal(result.ok, true)
    assert.equal(other.getItems().length, 0)
    assert.equal(other.current(), null)
  })

  it('повреждённый снимок не мутирует очередь', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.setQueue([t('keep'), t('also')], 0, { type: 'library' })
    queue.setRepeatMode('ALL')
    const before = queue.exportSessionState()

    const bad: PlaybackQueueSessionState = {
      ...before,
      currentIndex: 99,
      playOrder: [0],
    }
    const result = queue.importSessionState(bad)
    assert.equal(result.ok, false)

    const after = queue.exportSessionState()
    assert.deepEqual(after.items.map((i) => i.id), before.items.map((i) => i.id))
    assert.equal(after.currentIndex, before.currentIndex)
    assert.equal(after.repeatMode, 'ALL')
    assert.deepEqual(after.playOrder, before.playOrder)
  })

  it('import отклоняет pendingRemovalIds в durable снимке', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.setQueue([t('a')], 0)
    const result = queue.importSessionState({
      ...queue.exportSessionState(),
      pendingRemovalIds: ['a'],
    })
    assert.equal(result.ok, false)
  })

  it('strip previewUrl при export/import; нет аудиопобочных эффектов API', () => {
    installMemoryLocalStorage()
    const queue = new PlaybackQueue()
    queue.setQueue(
      [
        t('s', {
          previewUrl: 'https://cdn.example/stream?token=SECRET',
        }),
      ],
      0,
    )
    const exported = queue.exportSessionState()
    assert.equal(exported.items[0]!.previewUrl, null)

    let emissions = 0
    const restored = new PlaybackQueue()
    restored.subscribe(() => {
      emissions += 1
    })
    const emissionsBefore = emissions
    const result = restored.importSessionState(exported)
    assert.equal(result.ok, true)
    assert.equal(restored.getItems()[0]!.previewUrl, null)
    // ровно одно уведомление от import (subscribe уже дал initial)
    assert.equal(emissions, emissionsBefore + 1)
    // Queue не создаёт HTMLAudioElement
    assert.equal(
      typeof (restored as unknown as { audio?: unknown }).audio,
      'undefined',
    )
  })

  it('import атомарно уведомляет подписчиков согласованным снимком', () => {
    installMemoryLocalStorage()
    const source = new PlaybackQueue()
    source.setQueue([t('a'), t('b')], 1, { type: 'radio', id: 'my-wave', title: 'W', origin: 'favorites' })
    source.setRepeatMode('ONE')
    const state = source.exportSessionState()

    const target = new PlaybackQueue()
    target.setQueue([t('old')], 0)
    const seen: string[] = []
    target.subscribe((snap) => {
      seen.push(snap.items.map((i) => i.id).join(',') || 'empty')
    })
    seen.length = 0
    target.importSessionState(state)
    assert.equal(seen.length, 1)
    assert.equal(seen[0], 'yandex-music:a,yandex-music:b')
    assert.equal(target.getRepeatMode(), 'ONE')
    assert.equal(target.getPlaybackContext().type, 'radio')
  })

  it('legacy v1 ключ не мигрируется export/import API автоматически', () => {
    const memory = installMemoryLocalStorage()
    memory.set(
      PLAYBACK_QUEUE_STORAGE_KEY,
      JSON.stringify({
        items: [t('legacy')],
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
    // Новый queue читает v1 через constructor restore — это существующее поведение.
    const live = new PlaybackQueue()
    assert.equal(live.current()?.id, 'yandex-music:legacy')
    // exportSessionState не трогает чужие user-scoped session keys; v1 остаётся
    live.exportSessionState()
    assert.ok(memory.get(PLAYBACK_QUEUE_STORAGE_KEY))
  })
})
