import assert from 'node:assert/strict'
import test from 'node:test'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { buildUserTasteProfile } from '../taste/buildTasteProfile.ts'
import type { TasteInput, TasteLibraryTrack, TastePlaybackEvent } from '../taste/types.ts'
import { comparePersonalRadio } from './tasteCompare.ts'
import { DEV_RADIO_SELECTION_KEY, getRadioSelection, setRadioSelection } from './radioSelection.ts'
import {
  buildPersonalRadio,
  type RadioLibraryItem,
  type RadioSearchPort,
} from './recommend.ts'
import type { Track } from '../../types/track.ts'
import { toggleMyWave } from './toggleMyWave.ts'

const NOW = '2026-10-27T12:00:00.000Z'

function libraryItem(
  partial: Partial<RadioLibraryItem> & Pick<RadioLibraryItem, 'canonicalId' | 'title' | 'artist'>,
): RadioLibraryItem {
  return {
    liked: false,
    disliked: false,
    hidden: false,
    playCount: 0,
    skipped: 0,
    lastPlayed: null,
    copies: [{
      sourceId: 'yandex-music',
      externalId: partial.canonicalId,
      title: partial.title,
      artist: partial.artist,
    }],
    ...partial,
  }
}

function tasteTrack(partial: Partial<TasteLibraryTrack> & Pick<TasteLibraryTrack, 'canonicalTrackId' | 'title' | 'artist'>): TasteLibraryTrack {
  return {
    liked: false,
    disliked: false,
    hidden: false,
    playCount: 0,
    skipped: 0,
    lastPlayed: null,
    catalogIds: [],
    copies: [{
      sourceId: 'yandex-music',
      externalId: partial.canonicalTrackId,
      canonicalTrackId: partial.canonicalTrackId,
    }],
    ...partial,
  }
}

function played(canonicalTrackId: string, createdAt = NOW): TastePlaybackEvent {
  return {
    sessionId: `session-${canonicalTrackId}`,
    eventType: 'playback_completed',
    sourceId: 'yandex-music',
    externalId: canonicalTrackId,
    canonicalTrackId,
    listenedMs: 180_000,
    durationMs: 180_000,
    reason: null,
    createdAt,
  }
}

function found(externalId: string, title: string, artist: string): Track {
  return { id: `yandex-music:${externalId}`, sourceId: 'yandex-music', externalId, title, artist }
}

function port(search: RadioSearchPort['search']): RadioSearchPort {
  return {
    sources: [{ id: 'yandex-music' }],
    search,
    isPlayable: async (track) => !track.externalId.startsWith('dead'),
  }
}

function profileFrom(value: TasteInput, userId = 'user-a') {
  return buildUserTasteProfile(userId, value, NOW)
}

test('the taste selection flag stays off', () => {
  assert.equal(getRadioSelection(), 'library')
})

test('likes still drive the legacy radio and the taste radio can use the same artists', async () => {
  const items = [libraryItem({ canonicalId: 'loved', title: 'Север', artist: 'Поле', liked: true })]
  const profile = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  })
  const search: RadioSearchPort['search'] = async (_sourceId, artist) => [
    found('loved', 'Север', artist),
    found('new-1', 'Юг', artist),
  ]
  const comparison = await comparePersonalRadio(items, profile, port(search))
  assert.deepEqual(comparison.legacy.trackIds, ['yandex-music:new-1'])
  assert.deepEqual(comparison.taste.trackIds, ['yandex-music:new-1'])
  assert.equal(comparison.taste.negativeInResults, 0)
  assert.equal(comparison.artistSearchOnly, true)
})

test('listens without likes can seed the taste radio and not the legacy one', async () => {
  const items = [libraryItem({ canonicalId: 'heard', title: 'Север', artist: 'Поле', liked: false })]
  const profile = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'heard', title: 'Север', artist: 'Поле' })],
    catalogs: [],
    stats: [],
    events: [played('heard')],
    history: [],
  })
  const comparison = await comparePersonalRadio(
    items,
    profile,
    port(async (_sourceId, artist) => [found('fresh', 'Юг', artist)]),
  )
  assert.equal(comparison.legacy.status, 'no-likes')
  assert.deepEqual(comparison.legacy.trackIds, [])
  assert.deepEqual(comparison.taste.trackIds, ['yandex-music:fresh'])
  assert.equal(comparison.taste.uniqueArtists, 1)
  assert.equal(comparison.taste.heardShare, 0)
})

test('two songs by one artist keep the stronger seed and drop an explicit dislike', async () => {
  const items = [
    libraryItem({ canonicalId: 'high', title: 'Север', artist: 'Поле', liked: true }),
    libraryItem({ canonicalId: 'low', title: 'Юг', artist: 'Поле', liked: false }),
    libraryItem({ canonicalId: 'no', title: 'Туман', artist: 'Поле', disliked: true }),
  ]
  const profile = profileFrom({
    library: [
      tasteTrack({ canonicalTrackId: 'high', title: 'Север', artist: 'Поле', liked: true }),
      tasteTrack({ canonicalTrackId: 'low', title: 'Юг', artist: 'Поле' }),
      tasteTrack({ canonicalTrackId: 'no', title: 'Туман', artist: 'Поле', disliked: true }),
    ],
    catalogs: [],
    stats: [],
    events: [played('low', '2026-10-27T11:00:00.000Z')],
    history: [],
  })
  const queries: string[] = []
  const plan = await buildPersonalRadio(items, port(async (_sourceId, artist) => {
    queries.push(artist)
    return [
      found('high', 'Север', artist),
      found('low', 'Юг', artist),
      found('no', 'Туман', artist),
      found('fresh', 'Рассвет', artist),
    ]
  }), { selection: 'taste', taste: profile, rotation: 0 })
  assert.deepEqual(queries, ['Поле'])
  assert.deepEqual(plan.tracks.map((track) => track.externalId), ['fresh'])
  assert.equal(plan.tracks.some((track) => track.title === 'Туман'), false)
})

test('an early skip does not remove a track the way a dislike does', async () => {
  const profile = profileFrom({
    library: [
      tasteTrack({ canonicalTrackId: 'kept', title: 'Север', artist: 'Поле', liked: true }),
      tasteTrack({ canonicalTrackId: 'skip', title: 'Коротко', artist: 'Поле' }),
    ],
    catalogs: [],
    stats: [],
    events: [{
      ...played('skip'),
      eventType: 'playback_skipped',
      listenedMs: 8_000,
      reason: 'next',
    }],
    history: [],
  })
  const plan = await buildPersonalRadio([], port(async () => [
    found('skip', 'Коротко', 'Поле'),
    found('fresh', 'Юг', 'Поле'),
  ]), { selection: 'taste', taste: profile })
  assert.equal(plan.tracks.some((track) => track.externalId === 'skip'), true)
  assert.equal(plan.tracks.some((track) => track.externalId === 'fresh'), true)
})

test('several source copies stay one seed and an unplayable candidate is dropped', async () => {
  const profile = profileFrom({
    library: [tasteTrack({
      canonicalTrackId: 'canon',
      title: 'Север',
      artist: 'Поле',
      liked: true,
      copies: [
        { sourceId: 'yandex-music', externalId: 'ya', canonicalTrackId: 'canon' },
        { sourceId: 'local-folder', externalId: 'file', canonicalTrackId: 'canon' },
      ],
    })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  })
  const plan = await buildPersonalRadio([], port(async () => [
    found('ya', 'Север', 'Поле'),
    found('dead-1', 'Тишина', 'Поле'),
    found('alive', 'Юг', 'Поле'),
  ]), { selection: 'taste', taste: profile })
  assert.deepEqual(plan.tracks.map((track) => track.externalId), ['alive'])
})

test('no playable candidates do not report playback', async () => {
  const profile = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  })
  const plan = await buildPersonalRadio(
    [],
    port(async () => [found('dead-1', 'Тишина', 'Поле')]),
    { selection: 'taste', taste: profile },
  )
  assert.equal(plan.status, 'favorites')
  assert.equal(plan.origin, 'favorites')
  assert.notEqual(plan.status, 'ready')
})

test('an aborted taste request does not return a queue', async () => {
  const profile = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  })
  const signal = AbortSignal.abort()
  const plan = await buildPersonalRadio([], {
    sources: [{ id: 'yandex-music' }],
    search: async () => [found('fresh', 'Юг', 'Поле')],
    isPlayable: async () => true,
  }, { selection: 'taste', taste: profile, signal })
  assert.equal(plan.tracks.length, 0)
  assert.equal(plan.status, 'error')
})

test('switching accounts does not reuse the previous taste plan', async () => {
  const search: RadioSearchPort['search'] = async (_sourceId, artist) => [found(`for-${artist}`, 'Новая', artist)]
  const first = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'a', title: 'Север', artist: 'Поле', liked: true })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  }, 'user-a')
  const second = profileFrom({
    library: [tasteTrack({ canonicalTrackId: 'b', title: 'Город', artist: 'Река', liked: true })],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
  }, 'user-b')
  const planA = await buildPersonalRadio([], port(search), { selection: 'taste', taste: first })
  const planB = await buildPersonalRadio([], port(search), { selection: 'taste', taste: second })
  assert.equal(planA.tracks[0]?.artist, 'Поле')
  assert.equal(planB.tracks[0]?.artist, 'Река')
  assert.notEqual(planA.tracks[0]?.id, planB.tracks[0]?.id)
})

test('the default wave does not switch to taste selection', async () => {
  let tasteLoads = 0
  const plan = await toggleMyWave({
    readTransport: () => ({ radioActive: false, playing: false, paused: false, queueLength: 0 }),
    pause: () => undefined,
    resume: async () => undefined,
    play: async () => undefined,
    loadLibrary: () => [libraryItem({ canonicalId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    loadPort: async () => port(async () => [found('fresh', 'Юг', 'Поле')]),
    readRotation: () => 0,
    storeRotation: () => undefined,
    loadTasteProfile: async () => {
      tasteLoads += 1
      return profileFrom({
        library: [tasteTrack({ canonicalTrackId: 'other', title: 'Город', artist: 'Река', liked: true })],
        catalogs: [],
        stats: [],
        events: [],
        history: [],
      })
    },
  })
  assert.equal(tasteLoads, 0)
  assert.equal(plan.tracks[0]?.artist, 'Поле')
  setRadioSelection('taste')
  setRadioSelection('library')
})

test('comparison does not replace the playback queue', async () => {
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
  const queue = new PlaybackQueue()
  queue.setQueue([found('keep', 'Держать', 'Поле')], 0)
  const before = queue.getItems().map((track) => track.id)
  await comparePersonalRadio(
    [libraryItem({ canonicalId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    profileFrom({
      library: [tasteTrack({ canonicalTrackId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
      catalogs: [],
      stats: [],
      events: [],
      history: [],
    }),
    port(async () => [found('fresh', 'Юг', 'Поле')]),
  )
  assert.deepEqual(queue.getItems().map((track) => track.id), before)
})

test('taste mode does not fall back to the library algorithm without a profile', async () => {
  const plan = await toggleMyWave({
    readTransport: () => ({ radioActive: false, playing: false, paused: false, queueLength: 0 }),
    pause: () => undefined,
    resume: async () => undefined,
    play: async () => undefined,
    loadLibrary: () => [libraryItem({ canonicalId: 'loved', title: 'Север', artist: 'Поле', liked: true })],
    loadPort: async () => port(async () => [found('fresh', 'Юг', 'Поле')]),
    readRotation: () => 0,
    storeRotation: () => undefined,
    selection: 'taste',
    loadTasteProfile: async () => null,
  })
  assert.equal(plan.status, 'error')
  assert.equal(plan.tracks.length, 0)
})

test('a stored dev override does not change the default outside a dev build', () => {
  const previous = globalThis.sessionStorage
  const memory = new Map<string, string>([[DEV_RADIO_SELECTION_KEY, 'taste']])
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  })
  try {
    assert.equal(getRadioSelection(), 'library')
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: previous })
    }
  }
})
