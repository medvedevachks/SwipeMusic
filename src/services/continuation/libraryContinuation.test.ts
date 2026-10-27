import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isSearchSeedPlaybackEnabled } from './searchSeedPlayback.ts'
import {
  createLibraryContinuationProvider,
  sameVerifiedArtist,
  selectSearchContinuation,
  selectSearchContinuationQueue,
  type ContinuationLibraryTrack,
  type ContinuationSeed,
} from './libraryContinuation.ts'

function item(
  partial: Partial<ContinuationLibraryTrack> & Pick<ContinuationLibraryTrack, 'externalId' | 'title' | 'artist'>,
): ContinuationLibraryTrack {
  return {
    id: partial.id ?? `yandex-music:${partial.externalId}`,
    sourceId: partial.sourceId ?? 'yandex-music',
    externalId: partial.externalId,
    title: partial.title,
    artist: partial.artist,
    artistId: partial.artistId ?? null,
    liked: partial.liked ?? false,
    disliked: partial.disliked ?? false,
    hidden: partial.hidden ?? false,
    score: partial.score ?? 0,
    lastPlayed: partial.lastPlayed ?? null,
  }
}

function seed(partial: Partial<ContinuationSeed> & Pick<ContinuationSeed, 'title' | 'artist'>): ContinuationSeed {
  return {
    id: partial.id ?? 'yandex-music:seed',
    sourceId: partial.sourceId ?? 'yandex-music',
    title: partial.title,
    artist: partial.artist,
    artistId: partial.artistId ?? null,
  }
}

test('search continuation stays off when only browser storage asks for it', () => {
  const source = readFileSync(new URL('./searchSeedPlayback.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('sessionStorage'), false)
  const memory = new Map<string, string>([['swipe-music.dev.search-seed', '1']])
  const previous = globalThis.sessionStorage
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
    },
  })
  try {
    assert.equal(isSearchSeedPlaybackEnabled(), false)
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: previous })
    } else {
      Reflect.deleteProperty(globalThis, 'sessionStorage')
    }
  }
})

test('a liked library track continues a searched song and search rows are not an input', () => {
  const source = readFileSync(new URL('./libraryContinuation.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('buildPersonalRadio'), false)
  assert.equal(source.includes('/search'), false)
  const next = selectSearchContinuation({
    seed: seed({ title: 'Лес', artist: 'Green Apelsin' }),
    library: [
      item({ externalId: 'les', title: 'Лес', artist: 'Green Apelsin', liked: true, score: 8 }),
      item({ externalId: 'love', title: 'Love The Way You Lie', artist: 'Eminem, Rihanna', liked: true, score: 8 }),
    ],
    queueIds: [],
  })
  assert.equal(next?.track.externalId, 'love')
  assert.equal(next?.reason, 'library-like')
})

test('text-search false matches are not continuation candidates', () => {
  const next = selectSearchContinuation({
    seed: seed({ title: 'Лес', artist: 'Green Apelsin' }),
    library: [
      item({ externalId: 'orange', title: 'Апельсин', artist: 'Гио Пика' }),
      item({ externalId: 'quest', title: 'Settlers', artist: 'Evil Quest' }),
      item({ externalId: 'green', title: 'O Green World', artist: 'Gorillaz' }),
      item({ externalId: 'romance', title: 'A Fine Romance', artist: 'Ella Fitzgerald, Louis Armstrong' }),
      item({ externalId: 'snow', title: 'Снег', artist: 'Settlers', liked: true, score: 6 }),
    ],
    queueIds: [],
  })
  assert.equal(next?.track.artist, 'Settlers')
  assert.equal(next?.track.title, 'Снег')
})

test('same artist requires an id match or an unambiguous exact name', () => {
  assert.equal(
    sameVerifiedArtist(
      { sourceId: 'yandex-music', artist: 'Settlers', artistId: 's1' },
      { sourceId: 'yandex-music', artist: 'Settlers', artistId: 's2' },
      new Map(),
    ),
    false,
  )
  const ambiguous = new Map<string, ReadonlySet<string>>([
    ['yandex-music\0settlers', new Set(['s1', 's2'])],
  ])
  assert.equal(
    sameVerifiedArtist(
      { sourceId: 'yandex-music', artist: 'Settlers', artistId: null },
      { sourceId: 'yandex-music', artist: 'Settlers', artistId: null },
      ambiguous,
    ),
    false,
  )
  assert.equal(
    sameVerifiedArtist(
      { sourceId: 'yandex-music', artist: 'Eminem, Rihanna', artistId: null },
      { sourceId: 'yandex-music', artist: 'Eminem', artistId: null },
      new Map(),
    ),
    false,
  )
  const next = selectSearchContinuation({
    seed: seed({ title: 'Лес', artist: 'Settlers', artistId: 's1' }),
    library: [
      item({ externalId: 'other', title: 'По камушку', artist: 'Settlers', artistId: 's2', score: 0, lastPlayed: '2020-01-01' }),
      item({ externalId: 'same', title: 'Снег', artist: 'Settlers', artistId: 's1' }),
    ],
    queueIds: [],
  })
  assert.equal(next?.track.externalId, 'same')
  assert.equal(next?.reason, 'same-artist')
})

test('explicit dislike and a hidden track never continue playback', () => {
  const next = selectSearchContinuation({
    seed: seed({ title: 'Лес', artist: 'Green Apelsin' }),
    library: [
      item({ externalId: 'no', title: 'Туман', artist: 'Settlers', liked: true, disliked: true, score: 8 }),
      item({ externalId: 'hide', title: 'Ночь', artist: 'Settlers', score: 4, hidden: true }),
      item({ externalId: 'skip', title: 'Коротко', artist: 'Settlers', score: -1, lastPlayed: '2020-01-01' }),
    ],
    queueIds: [],
  })
  assert.equal(next, null)
})

test('a chain does not repeat a played song or return to the seed copy', () => {
  const chain = selectSearchContinuationQueue({
    seed: seed({ id: 'yandex-music:search-les', title: 'Лес', artist: 'Green Apelsin' }),
    library: [
      item({
        id: 'yandex-music:library-les',
        externalId: 'library-les',
        title: 'Лес',
        artist: 'Green Apelsin',
        liked: true,
        score: 11,
      }),
      item({ externalId: 'love', title: 'Love The Way You Lie', artist: 'Eminem, Rihanna', liked: true, score: 8 }),
      item({ externalId: 'settlers', title: 'Лес', artist: 'Settlers', liked: true, score: 6 }),
      item({ externalId: 'hunt', title: 'Охота на лисицу', artist: 'Green Apelsin', score: 1 }),
      item({ externalId: 'orange', title: 'Апельсин', artist: 'Гио Пика' }),
    ],
    queueIds: ['yandex-music:search-les'],
    limit: 6,
  })
  assert.deepEqual(
    chain.map((pick) => pick.track.externalId),
    ['love', 'settlers', 'hunt'],
  )
})

test('an empty library and a library without suitable tracks stop the chain', () => {
  const current = seed({ title: 'Лес', artist: 'Green Apelsin' })
  assert.equal(selectSearchContinuation({ seed: current, library: [], queueIds: [] }), null)
  assert.equal(
    selectSearchContinuation({
      seed: current,
      library: [
        item({ externalId: 'orange', title: 'Апельсин', artist: 'Гио Пика', score: -2 }),
        item({ externalId: 'green', title: 'O Green World', artist: 'Gorillaz', score: -2, lastPlayed: '2020-01-01' }),
      ],
      queueIds: [],
    }),
    null,
  )
})

test('several continuations walk known tracks and then stop', () => {
  const library = [
    item({ externalId: 'a', title: 'Снег', artist: 'Settlers', liked: true, score: 6 }),
    item({ externalId: 'b', title: 'Love The Way You Lie', artist: 'Eminem, Rihanna', liked: true, score: 8 }),
    item({ externalId: 'c', title: 'Охота на лисицу', artist: 'Green Apelsin', score: 2, lastPlayed: '2024-01-01' }),
  ]
  const chain = selectSearchContinuationQueue({
    seed: seed({ id: 'yandex-music:seed', title: 'Новая', artist: 'Незнакомец' }),
    library,
    queueIds: [],
    limit: 5,
  })
  assert.deepEqual(chain.map((pick) => pick.track.externalId), ['b', 'a', 'c'])
})

test('an unplayable candidate is skipped and a later library track is kept', async () => {
  const provider = createLibraryContinuationProvider({
    loadProfile: async () => null,
    loadLibrary: async () => [
      item({ externalId: 'dead', title: 'Тишина', artist: 'Settlers', liked: true }),
      item({ externalId: 'alive', title: 'Снег', artist: 'Settlers', liked: true }),
    ],
    isPlayable: async (track) => track.externalId !== 'dead',
  })
  const candidate = await provider.prepareContinuation(
    { id: 'yandex-music:seed', sourceId: 'yandex-music', externalId: 'seed', title: 'Лес', artist: 'Green Apelsin' },
    { type: 'search-seed', query: 'лес', seedTrackId: 'yandex-music:seed' },
    { generation: 1, aborted: false },
  )
  assert.equal(candidate?.track.externalId, 'alive')
})

test('a refused playable check is skipped and the current song is not failed', async () => {
  const provider = createLibraryContinuationProvider({
    loadProfile: async () => null,
    loadLibrary: async () => [
      item({ externalId: 'dead', title: 'Тишина', artist: 'Settlers', liked: true }),
      item({ externalId: 'alive', title: 'Снег', artist: 'Settlers', liked: true }),
    ],
    isPlayable: async (track) => {
      if (track.externalId === 'dead') {
        throw new Error('yandex refused')
      }
      return true
    },
  })
  const candidate = await provider.prepareContinuation(
    { id: 'yandex-music:seed', sourceId: 'yandex-music', externalId: 'seed', title: 'Лес', artist: 'Green Apelsin' },
    { type: 'search-seed', query: 'лес', seedTrackId: 'yandex-music:seed' },
    { generation: 1, aborted: false },
  )
  assert.equal(candidate?.track.externalId, 'alive')
})

test('an aborted continuation does not return a late candidate', async () => {
  const provider = createLibraryContinuationProvider({
    loadProfile: async () => null,
    loadLibrary: async () => [item({ externalId: 'love', title: 'Love The Way You Lie', artist: 'Eminem, Rihanna', liked: true })],
    isPlayable: async () => true,
  })
  const candidate = await provider.prepareContinuation(
    { id: 'yandex-music:seed', sourceId: 'yandex-music', externalId: 'seed', title: 'Лес', artist: 'Green Apelsin' },
    { type: 'search-seed', query: 'лес', seedTrackId: 'yandex-music:seed' },
    { generation: 1, aborted: true },
  )
  assert.equal(candidate, null)
})

test('a failed continuation lookup does not throw', async () => {
  const provider = createLibraryContinuationProvider({
    loadProfile: async () => {
      throw new Error('profile')
    },
    loadLibrary: async () => [],
    isPlayable: async () => true,
  })
  const candidate = await provider.prepareContinuation(
    { id: 'yandex-music:seed', sourceId: 'yandex-music', externalId: 'seed', title: 'Лес', artist: 'Green Apelsin' },
    { type: 'search-seed', query: 'лес', seedTrackId: 'yandex-music:seed' },
    { generation: 1, aborted: false },
  )
  assert.equal(candidate, null)
})
