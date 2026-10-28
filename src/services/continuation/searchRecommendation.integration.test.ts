/**
 * A–G: search-seed + Recommendation Engine через реальные
 * PlaybackQueue / ContinuationSession / consumeSearchSeedAdvance.
 * Каталог контролируемый (mock port), без production Yandex.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type { RecommendationCatalogPort } from '../recommendation/index.ts'
import type { ContinuationLibraryTrack } from './libraryContinuation.ts'
import {
  commitSearchSeedQueue,
  consumeSearchSeedAdvance,
  setSearchSeedPlaybackEnabled,
} from './searchSeedPlayback.ts'
import {
  ContinuationSession,
  resetContinuationSessionForTests,
} from './ContinuationSession.ts'
import { createSearchRecommendationProvider } from './searchContinuationRuntime.ts'
import type { Track } from '../../types/track.ts'
import type { UserTasteProfile } from '../taste/types.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function lib(
  partial: Partial<ContinuationLibraryTrack> &
    Pick<ContinuationLibraryTrack, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): ContinuationLibraryTrack {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    artistId: null,
    liked: partial.liked ?? false,
    disliked: false,
    hidden: false,
    score: partial.score ?? 0,
    lastPlayed: null,
    ...partial,
  }
}

function emptyTaste(): UserTasteProfile {
  return {
    schemaVersion: 1,
    userId: 'dev',
    builtAt: '2026-01-01T00:00:00.000Z',
    empty: true,
    tracks: [],
    catalogs: [],
    recentActivity: [],
  }
}

function mockPort(catalog: Record<string, Track[]>, playable: Set<string>): RecommendationCatalogPort {
  return {
    sources: [{ id: 'mock-catalog' }],
    async search(_sourceId, query) {
      return catalog[query.trim().toLowerCase()] ?? []
    },
    async isPlayable(candidate) {
      return playable.has(candidate.id)
    },
  }
}

function snapshot(queue: PlaybackQueue) {
  const snap = queue.getSnapshot()
  return {
    context: snap.context.type,
    queueLength: snap.items.length,
    currentId: queue.current()?.id ?? null,
    currentTitle: queue.current()?.title ?? null,
    peekNextId: queue.peekNext()?.id ?? null,
  }
}

async function seedSession(input: {
  seed: Track
  library: ContinuationLibraryTrack[]
  catalog: Record<string, Track[]>
  playable: Set<string>
  taste?: UserTasteProfile
}) {
  setSearchSeedPlaybackEnabled(true)
  resetContinuationSessionForTests()
  const queue = new PlaybackQueue()
  const session = new ContinuationSession(
    createSearchRecommendationProvider({
      loadProfile: async () => input.taste ?? emptyTaste(),
      loadLibrary: async () => input.library,
      createPort: async () => mockPort(input.catalog, input.playable),
      excludedTracks: () =>
        queue.getItems().map((item) => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          sourceId: item.sourceId,
          externalId: item.externalId,
        })),
    }),
  )
  commitSearchSeedQueue(queue, session, { track: input.seed, query: 'Сплин' })
  await session.flush()
  return { queue, session }
}

const atl = track({
  sourceId: 'yandex-music',
  externalId: 'atl',
  title: 'ATL',
  artist: 'Сплин',
})
const rec1 = track({
  sourceId: 'mock-catalog',
  externalId: 'rec-1',
  title: 'Recommendation 1',
  artist: 'Сплин',
})
const rec2 = track({
  sourceId: 'mock-catalog',
  externalId: 'rec-2',
  title: 'Recommendation 2',
  artist: 'Сплин',
})
const searchHit2 = track({
  sourceId: 'yandex-music',
  externalId: 'hit-2',
  title: 'Murovei',
  artist: 'Сплин',
})

test('A: Search→ATL→Next→Rec1→Next→Rec2 keeps search-seed and never queues search hits', async () => {
  const searchDump = [atl, searchHit2, ...Array.from({ length: 18 }, (_, i) =>
    track({
      sourceId: 'yandex-music',
      externalId: `hit-${i + 3}`,
      title: `Hit ${i + 3}`,
      artist: 'Сплин',
    }),
  )]
  assert.equal(searchDump.length, 20)

  const { queue, session } = await seedSession({
    seed: atl,
    library: [lib({ ...atl, liked: true })],
    catalog: { сплин: [rec1, rec2, searchHit2] },
    playable: new Set([rec1.id, rec2.id, searchHit2.id]),
  })

  const before = snapshot(queue)
  assert.equal(before.context, 'search-seed')
  assert.equal(before.queueLength, 1)
  assert.equal(before.currentId, atl.id)

  const first = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(first?.id, rec1.id)
  const afterFirst = snapshot(queue)
  assert.equal(afterFirst.context, 'search-seed')
  assert.equal(afterFirst.queueLength, 2)
  assert.equal(afterFirst.currentId, rec1.id)
  assert.equal(
    queue.getItems().some((item) => item.id === searchHit2.id),
    false,
  )

  session.prepare(rec1, {
    type: 'search-seed',
    query: 'Сплин',
    seedTrackId: atl.id,
  })
  await session.flush()

  const second = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(second?.id, rec2.id)
  const afterSecond = snapshot(queue)
  assert.equal(afterSecond.context, 'search-seed')
  assert.equal(afterSecond.currentId, rec2.id)
  assert.ok(afterSecond.queueLength >= 2)
  assert.equal(
    queue.getItems().some((item) => searchDump.slice(1).some((hit) => hit.id === item.id)),
    false,
  )
})

test('B: ended advances to Recommendation 1', async () => {
  const { queue, session } = await seedSession({
    seed: atl,
    library: [lib({ ...atl, liked: true })],
    catalog: { сплин: [rec1] },
    playable: new Set([rec1.id]),
  })
  const before = snapshot(queue)
  const next = consumeSearchSeedAdvance(queue, session, { fromEnded: true })
  const after = snapshot(queue)
  assert.equal(before.context, 'search-seed')
  assert.equal(after.context, 'search-seed')
  assert.equal(next?.id, rec1.id)
  assert.equal(after.currentTitle, 'Recommendation 1')
})

test('C: gesture forward uses the same recommendation advance path as Next', async () => {
  // Home.playListedTrack(advance) → AudioPlayer.next → playRecommendationAdvance → resolveRecommendationAdvance
  const home = readFileSync(new URL('../../pages/Home.tsx', import.meta.url), 'utf8')
  const player = readFileSync(new URL('../audioPlayer/AudioPlayer.ts', import.meta.url), 'utf8')
  assert.match(home, /intent === 'advance'/)
  assert.match(home, /getAudioPlayer\(\)\.next\(\)/)
  assert.match(player, /playRecommendationAdvance\(false\)/)
  assert.match(player, /resolveRecommendationAdvance/)

  const { queue, session } = await seedSession({
    seed: atl,
    library: [lib({ ...atl, liked: true })],
    catalog: { сплин: [rec1] },
    playable: new Set([rec1.id]),
  })
  const advanced = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(advanced?.id, rec1.id)
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
})

test('D: rapid double Next does not double-consume the same prepared track', async () => {
  const { queue, session } = await seedSession({
    seed: atl,
    library: [lib({ ...atl, liked: true })],
    catalog: { сплин: [rec1, rec2] },
    playable: new Set([rec1.id, rec2.id]),
  })
  const first = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  const immediate = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(first?.id, rec1.id)
  // Без нового prepare второй advance не должен повторно отдать тот же takePrepared.
  assert.equal(immediate, null)
  assert.equal(queue.current()?.id, rec1.id)
})

test('E: empty library with taste + catalog still recommends', async () => {
  const taste: UserTasteProfile = {
    ...emptyTaste(),
    empty: false,
    tracks: [
      {
        key: { kind: 'canonical', canonicalTrackId: 'c1' },
        label: { title: 'ATL', artist: 'Сплин' },
        copies: [],
        score: 4,
        signals: [],
        lastPlayed: null,
      },
    ],
  }
  const { queue, session } = await seedSession({
    seed: atl,
    library: [],
    catalog: { сплин: [rec1] },
    playable: new Set([rec1.id]),
    taste,
  })
  const next = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(next?.id, rec1.id)
  assert.equal(snapshot(queue).context, 'search-seed')
})

test('F: no available recommendation yields explicit miss (stop, not search hit)', async () => {
  const { queue, session } = await seedSession({
    seed: atl,
    library: [],
    catalog: { сплин: [rec1] },
    playable: new Set(),
  })
  const before = snapshot(queue)
  const next = consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  const after = snapshot(queue)
  assert.equal(next, null)
  assert.equal(before.context, 'search-seed')
  assert.equal(after.context, 'search-seed')
  assert.equal(after.queueLength, 1)
  assert.equal(after.currentId, atl.id)
})

test('G: search results never enter PlaybackQueue on seed commit or advance', async () => {
  const hits = Array.from({ length: 20 }, (_, index) =>
    track({
      sourceId: 'yandex-music',
      externalId: `dump-${index}`,
      title: index === 0 ? 'ATL' : `Hit ${index}`,
      artist: 'Сплин',
    }),
  )
  const { queue, session } = await seedSession({
    seed: hits[0]!,
    library: [lib({ ...hits[0]!, liked: true })],
    catalog: { сплин: [rec1] },
    playable: new Set([rec1.id]),
  })
  assert.deepEqual(
    queue.getItems().map((item) => item.id),
    [hits[0]!.id],
  )
  consumeSearchSeedAdvance(queue, session, { fromEnded: false })
  assert.equal(
    queue.getItems().some((item) => hits.slice(1).some((hit) => hit.id === item.id)),
    false,
  )
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
})

test('runtime wiring uses Recommendation Engine, not libraryContinuation provider', () => {
  const runtime = readFileSync(new URL('./searchContinuationRuntime.ts', import.meta.url), 'utf8')
  const intent = readFileSync(new URL('../playbackIntent/PlaybackIntent.ts', import.meta.url), 'utf8')
  assert.match(runtime, /createRecommendationContinuationProvider/)
  assert.match(runtime, /createLiveRadioPort/)
  assert.match(runtime, /ensureSearchRecommendation/)
  assert.equal(runtime.includes('createLibraryContinuationProvider'), false)
  assert.match(intent, /ensureSearchRecommendation/)
})
