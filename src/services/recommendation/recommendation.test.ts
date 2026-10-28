import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import {
  recommendNext,
  sameRecommendationStrategy,
  type RecommendationCatalogPort,
  type RecommendationRequest,
} from './index.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function libraryItem(
  partial: Partial<ContinuationLibraryTrack> &
    Pick<ContinuationLibraryTrack, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): ContinuationLibraryTrack {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    artistId: partial.artistId ?? null,
    liked: partial.liked ?? false,
    disliked: partial.disliked ?? false,
    hidden: partial.hidden ?? false,
    score: partial.score ?? 0,
    lastPlayed: partial.lastPlayed ?? null,
    ...partial,
  }
}

function emptyTaste(userId = 'u1'): UserTasteProfile {
  return {
    schemaVersion: 1,
    userId,
    builtAt: '2026-01-01T00:00:00.000Z',
    empty: true,
    tracks: [],
    catalogs: [],
    recentActivity: [],
  }
}

function mockPort(input: {
  sources?: { id: string }[]
  catalog?: Record<string, Track[]>
  playable?: Set<string> | ((track: Track) => boolean)
  searchDelayMs?: number
}): RecommendationCatalogPort & { searches: string[] } {
  const searches: string[] = []
  const playable = input.playable ?? new Set<string>()
  return {
    sources: input.sources ?? [{ id: 'yandex-music' }],
    searches,
    async search(sourceId, query, signal) {
      searches.push(`${sourceId}:${query}`)
      if (input.searchDelayMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, input.searchDelayMs)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('aborted'))
          })
        })
      }
      if (signal.aborted) {
        throw new Error('aborted')
      }
      const key = query.trim().toLowerCase()
      return (input.catalog?.[key] ?? []).filter((item) => item.sourceId === sourceId || true)
    },
    async isPlayable(candidate, signal) {
      if (signal.aborted) {
        throw new Error('aborted')
      }
      if (typeof playable === 'function') {
        return playable(candidate)
      }
      return playable.has(candidate.id)
    },
  }
}

function baseRequest(
  overrides: Partial<RecommendationRequest> &
    Pick<RecommendationRequest, 'mode' | 'current' | 'port'>,
): RecommendationRequest {
  return {
    taste: emptyTaste(),
    excluded: [],
    library: [],
    ...overrides,
  }
}

test('picks a catalog track outside the personal library', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'atl',
    title: 'ATL',
    artist: 'Сплин',
  })
  const catalogHit = track({
    sourceId: 'yandex-music',
    externalId: 'murovei',
    title: 'Murovei',
    artist: 'Сплин',
  })
  const port = mockPort({
    catalog: { сплин: [catalogHit] },
    playable: new Set([catalogHit.id]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current,
      library: [
        libraryItem({
          sourceId: 'yandex-music',
          externalId: 'atl',
          title: 'ATL',
          artist: 'Сплин',
          liked: true,
        }),
      ],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.id, catalogHit.id)
    // Liked seed artist → catalog search tagged taste-positive.
    assert.equal(result.reason, 'taste-positive')
  }
  assert.ok(port.searches.some((item) => item.includes('Сплин')))
})

test('hard-excludes search hits even when Сплин likes would win', async () => {
  const current = track({
    sourceId: 'dev-acceptance',
    externalId: 'atl',
    title: 'ATL',
    artist: 'Сплин',
  })
  const searchHits = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'seed',
      title: 'Seed Song',
      artist: 'Сплин',
    }),
    current,
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-1',
      title: 'Recommendation 1',
      artist: 'Сплин',
    }),
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-2',
      title: 'Recommendation 2',
      artist: 'Сплин',
    }),
  ]
  const outside = track({
    sourceId: 'dev-acceptance',
    externalId: 'kino-blood',
    title: 'Группа крови',
    artist: 'Кино',
  })
  const port = mockPort({
    catalog: {
      сплин: searchHits.filter((item) => item.externalId !== 'atl'),
      кино: [outside],
    },
    playable: new Set([
      ...searchHits.map((item) => item.id),
      outside.id,
    ]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current,
      excluded: searchHits.map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        sourceId: item.sourceId,
        externalId: item.externalId,
      })),
      library: [
        libraryItem({
          sourceId: 'dev-acceptance',
          externalId: 'rec-1',
          title: 'Recommendation 1',
          artist: 'Сплин',
          liked: true,
          score: 20,
          lastPlayed: '2026-10-27T12:00:00.000Z',
        }),
        libraryItem({
          sourceId: 'dev-acceptance',
          externalId: 'kino-blood',
          title: 'Группа крови',
          artist: 'Кино',
          liked: true,
          score: 5,
          lastPlayed: '2026-10-20T12:00:00.000Z',
        }),
      ],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.externalId, 'kino-blood')
    assert.equal(result.track.artist, 'Кино')
  }
})

test('taste / liked artists beat same-artist search dump after ATL', async () => {
  const current = track({
    sourceId: 'dev-acceptance',
    externalId: 'atl',
    title: 'ATL',
    artist: 'Сплин',
  })
  const searchDump = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-1',
      title: 'Recommendation 1',
      artist: 'Сплин',
    }),
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-2',
      title: 'Recommendation 2',
      artist: 'Сплин',
    }),
  ]
  const kinoHit = track({
    sourceId: 'dev-acceptance',
    externalId: 'kino-blood',
    title: 'Группа крови',
    artist: 'Кино',
  })
  const port = mockPort({
    catalog: {
      сплин: searchDump,
      кино: [kinoHit],
    },
    playable: new Set([
      ...searchDump.map((item) => item.id),
      kinoHit.id,
    ]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current,
      library: [
        libraryItem({
          sourceId: 'dev-acceptance',
          externalId: 'kino-blood',
          title: 'Группа крови',
          artist: 'Кино',
          liked: true,
          score: 8,
          lastPlayed: '2026-10-20T12:00:00.000Z',
        }),
        libraryItem({
          sourceId: 'dev-acceptance',
          externalId: 'seed',
          title: 'Seed Song',
          artist: 'Сплин',
          liked: true,
          score: 1,
          lastPlayed: '2026-01-01T00:00:00.000Z',
        }),
      ],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.externalId, 'kino-blood')
    assert.equal(result.track.artist, 'Кино')
    assert.notEqual(result.track.artist, 'Сплин')
  }
  assert.ok(port.searches.some((item) => /кино/i.test(item)))
})

test('user seed current drives next recommendation', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'seed',
    title: 'Seed',
    artist: 'Би-2',
  })
  const next = track({
    sourceId: 'yandex-music',
    externalId: 'next',
    title: 'Next',
    artist: 'Би-2',
  })
  const port = mockPort({
    catalog: { 'би-2': [next] },
    playable: new Set([next.id]),
  })
  const result = await recommendNext(
    baseRequest({ mode: 'wave', current, port }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.id, next.id)
  }
})

test('automatic start without current uses liked library then catalog', async () => {
  const liked = libraryItem({
    sourceId: 'yandex-music',
    externalId: 'liked-1',
    title: 'Liked',
    artist: 'Сплин',
    liked: true,
    score: 3,
  })
  const catalogHit = track({
    sourceId: 'yandex-music',
    externalId: 'fresh',
    title: 'Fresh',
    artist: 'Сплин',
  })
  const port = mockPort({
    catalog: { сплин: [catalogHit] },
    playable: new Set([liked.id, catalogHit.id]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current: null,
      library: [liked],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    // Cold start prefers playable liked library first.
    assert.equal(result.track.id, liked.id)
    assert.equal(result.reason, 'library-like')
  }
})

test('excludes already proposed tracks and prefers the next catalog hit', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'a',
    title: 'A',
    artist: 'X',
  })
  const first = track({
    sourceId: 'yandex-music',
    externalId: 'b',
    title: 'B',
    artist: 'X',
  })
  const second = track({
    sourceId: 'yandex-music',
    externalId: 'c',
    title: 'C',
    artist: 'X',
  })
  const port = mockPort({
    catalog: { x: [first, second] },
    playable: new Set([first.id, second.id]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current,
      excluded: [{ id: first.id, title: first.title, artist: first.artist }],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.id, second.id)
  }
})

test('returns controlled miss when nothing is available', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'only',
    title: 'Only',
    artist: 'Solo',
  })
  const port = mockPort({
    catalog: { solo: [] },
    playable: new Set(),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'wave',
      current,
      library: [],
      port,
    }),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.emptyReason, 'no-candidates')
  }
})

test('all candidates unavailable yields all-unavailable', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'cur',
    title: 'Cur',
    artist: 'Band',
  })
  const hit = track({
    sourceId: 'yandex-music',
    externalId: 'hit',
    title: 'Hit',
    artist: 'Band',
  })
  const port = mockPort({
    catalog: { band: [hit] },
    playable: new Set(),
  })
  const result = await recommendNext(
    baseRequest({ mode: 'swipe', current, port }),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.emptyReason, 'all-unavailable')
  }
})

test('swipe and wave share the same base strategy and pick', async () => {
  assert.equal(sameRecommendationStrategy('swipe', 'wave'), true)
  const current = track({
    sourceId: 'yandex-music',
    externalId: 's',
    title: 'S',
    artist: 'Artist',
  })
  const hit = track({
    sourceId: 'yandex-music',
    externalId: 'h',
    title: 'H',
    artist: 'Artist',
  })
  const make = (mode: 'swipe' | 'wave') =>
    recommendNext(
      baseRequest({
        mode,
        current,
        port: mockPort({
          catalog: { artist: [hit] },
          playable: new Set([hit.id]),
        }),
      }),
    )
  const swipe = await make('swipe')
  const wave = await make('wave')
  assert.equal(swipe.ok, true)
  assert.equal(wave.ok, true)
  if (swipe.ok && wave.ok) {
    assert.equal(swipe.track.id, wave.track.id)
    assert.equal(swipe.reason, wave.reason)
    assert.equal(swipe.mode, 'swipe')
    assert.equal(wave.mode, 'wave')
  }
})

test('no-seed cold start without likes is controlled', async () => {
  const port = mockPort({ catalog: {}, playable: new Set() })
  const result = await recommendNext(
    baseRequest({
      mode: 'swipe',
      current: null,
      library: [
        libraryItem({
          sourceId: 'yandex-music',
          externalId: 'neutral',
          title: 'Neutral',
          artist: 'N',
          liked: false,
        }),
      ],
      port,
    }),
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.emptyReason, 'no-seed')
  }
})

test('library-like candidate can win over catalog when ranked first and playable', async () => {
  const current = track({
    sourceId: 'yandex-music',
    externalId: 'seed',
    title: 'Seed',
    artist: 'Сплин',
  })
  const liked = libraryItem({
    sourceId: 'yandex-music',
    externalId: 'like-2',
    title: 'Друг',
    artist: 'Сплин',
    liked: true,
  })
  const catalogHit = track({
    sourceId: 'yandex-music',
    externalId: 'cat',
    title: 'Catalog',
    artist: 'Сплин',
  })
  const port = mockPort({
    catalog: { сплин: [catalogHit] },
    playable: new Set([liked.id, catalogHit.id]),
  })
  const result = await recommendNext(
    baseRequest({
      mode: 'wave',
      current,
      library: [
        libraryItem({
          sourceId: 'yandex-music',
          externalId: 'seed',
          title: 'Seed',
          artist: 'Сплин',
          liked: true,
        }),
        liked,
      ],
      port,
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.id, liked.id)
    assert.equal(result.reason, 'library-like')
  }
})
