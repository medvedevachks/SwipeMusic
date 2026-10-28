import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  PlaybackQueue,
  PLAYBACK_QUEUE_STORAGE_KEY,
  type PersistedPlaybackQueue,
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

async function flushPersist(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250))
}

function readPersisted(): PersistedPlaybackQueue | null {
  const raw = localStorage.getItem(PLAYBACK_QUEUE_STORAGE_KEY)
  if (!raw) {
    return null
  }
  return JSON.parse(raw) as PersistedPlaybackQueue
}

test('persist writes sessionTailIds; reload keeps real insertNext for Previous→Next', async () => {
  installMemoryLocalStorage()
  const seed = track({ sourceId: 'yandex-music', externalId: 'atl', title: 'ATL', artist: 'Сплин' })
  const rec = track({
    sourceId: 'yandex-music',
    externalId: 'rec1',
    title: 'Мой друг',
    artist: 'Сплин',
  })
  const queue = new PlaybackQueue()
  queue.setQueue([seed], 0, {
    type: 'search-seed',
    query: 'Сплин',
    seedTrackId: seed.id,
  })
  queue.insertNext(rec)
  await flushPersist()

  const saved = readPersisted()
  assert.ok(saved)
  assert.ok(Object.prototype.hasOwnProperty.call(saved, 'sessionTailIds'))
  assert.deepEqual(saved.sessionTailIds, [rec.id])
  assert.equal(saved.items.length, 2)

  const restored = new PlaybackQueue()
  assert.equal(restored.current()?.id, seed.id)
  assert.equal(restored.peekNext()?.id, rec.id)

  restored.next()
  assert.equal(restored.current()?.id, rec.id)
  restored.previous()
  assert.equal(restored.current()?.id, seed.id)
  assert.equal(restored.peekNext()?.id, rec.id)

  restored.trimUnplayedTail()
  assert.deepEqual(
    restored.getItems().map((item) => item.id),
    [seed.id, rec.id],
  )
})

test('legacy search-seed with 20 hits: after reload Next is not hit-2', () => {
  const memory = installMemoryLocalStorage()
  const hits = Array.from({ length: 20 }, (_, index) =>
    track({
      sourceId: 'yandex-music',
      externalId: `hit-${index + 1}`,
      title: `Hit ${index + 1}`,
      artist: 'X',
    }),
  )
  const legacy: PersistedPlaybackQueue = {
    items: hits,
    currentIndex: 0,
    playOrder: hits.map((_, index) => index),
    playOrderIndex: 0,
    repeatMode: 'OFF',
    shuffleMode: 'OFF',
    history: [hits[0]!.id],
    context: {
      type: 'search-seed',
      query: 'би-2',
      seedTrackId: hits[0]!.id,
    },
  }
  // Без sessionTailIds — старый dump выдачи.
  memory.set(PLAYBACK_QUEUE_STORAGE_KEY, JSON.stringify(legacy))
  assert.equal(
    Object.prototype.hasOwnProperty.call(JSON.parse(memory.get(PLAYBACK_QUEUE_STORAGE_KEY)!), 'sessionTailIds'),
    false,
  )

  const restored = new PlaybackQueue()
  assert.equal(restored.getItems().length, 1)
  assert.equal(restored.current()?.id, hits[0]!.id)
  assert.equal(restored.peekNext(), null)
  assert.deepEqual(restored.getSnapshot().history, [hits[0]!.id])
})

test('legacy album playlist swipe radio keep full queue after restore', () => {
  const cases: Array<{
    label: string
    context: PersistedPlaybackQueue['context']
  }> = [
    {
      label: 'album',
      context: { type: 'album', id: 'a1', title: 'Album' },
    },
    {
      label: 'playlist',
      context: { type: 'playlist', id: 'p1', title: 'Playlist' },
    },
    {
      label: 'swipe',
      context: { type: 'swipe' },
    },
    {
      label: 'radio',
      context: {
        type: 'radio',
        id: 'my-wave',
        title: 'Моя волна',
        origin: 'recommendations',
      },
    },
  ]

  for (const entry of cases) {
    const memory = installMemoryLocalStorage()
    const tracks = [
      track({ sourceId: 'yandex-music', externalId: `${entry.label}-1`, title: 'One', artist: 'A' }),
      track({ sourceId: 'yandex-music', externalId: `${entry.label}-2`, title: 'Two', artist: 'A' }),
      track({ sourceId: 'yandex-music', externalId: `${entry.label}-3`, title: 'Three', artist: 'A' }),
    ]
    const legacy: PersistedPlaybackQueue = {
      items: tracks,
      currentIndex: 0,
      playOrder: [0, 1, 2],
      playOrderIndex: 0,
      repeatMode: 'OFF',
      shuffleMode: 'OFF',
      history: [tracks[0]!.id],
      context: entry.context,
    }
    memory.set(PLAYBACK_QUEUE_STORAGE_KEY, JSON.stringify(legacy))

    const restored = new PlaybackQueue()
    assert.equal(restored.getItems().length, 3, entry.label)
    assert.equal(restored.current()?.id, tracks[0]!.id, entry.label)
    assert.equal(restored.peekNext()?.id, tracks[1]!.id, entry.label)
    assert.deepEqual(restored.getSnapshot().history, [tracks[0]!.id], entry.label)
    assert.equal(restored.next()?.id, tracks[1]!.id, entry.label)
    assert.equal(restored.peekNext()?.id, tracks[2]!.id, entry.label)
  }
})

test('new persist with empty sessionTailIds is trusted (no legacy migration)', async () => {
  installMemoryLocalStorage()
  const seed = track({ sourceId: 'yandex-music', externalId: 's', title: 'Seed', artist: 'A' })
  const foreign = track({ sourceId: 'yandex-music', externalId: 'h2', title: 'Hit2', artist: 'B' })
  const queue = new PlaybackQueue()
  queue.setQueue([seed, foreign], 0, {
    type: 'search-seed',
    query: 'q',
    seedTrackId: seed.id,
  })
  // setQueue очищает sessionTailIds; persist должен записать [].
  await flushPersist()
  const saved = readPersisted()
  assert.ok(saved)
  assert.deepEqual(saved.sessionTailIds, [])

  const restored = new PlaybackQueue()
  // С явным [] не мигрируем срезом — items остаются как сохранены.
  assert.equal(restored.getItems().length, 2)
  restored.trimUnplayedTail()
  assert.deepEqual(restored.getItems().map((item) => item.id), [seed.id])
})
