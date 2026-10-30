/**
 * RECOMMENDATION-INTEGRATION-03 A–I:
 * Swipe / Wave / Search → единый Recommendation Engine + advance.
 * Контролируемый каталог, без production Yandex.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import {
  ContinuationSession,
  resetContinuationSessionForTests,
} from '../continuation/ContinuationSession.ts'
import { createSearchRecommendationProvider } from '../continuation/searchContinuationRuntime.ts'
import {
  commitSearchSeedQueue,
  setSearchSeedPlaybackEnabled,
} from '../continuation/searchSeedPlayback.ts'
import type { Track } from '../../types/track.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import {
  consumeRecommendationAdvance,
  isRecommendationAdvanceContext,
  resolveRecommendationAdvance,
} from './advance.ts'
import { setActiveRecommendationMode } from './sessionState.ts'
import { classifySwipeTrack } from '../swipeClassification/classifySwipeTrack.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import {
  activateRecommendationSession,
  commitRecommendationSeed,
  enqueueRecommendationAdvance,
  getRecommendationSessionMode,
  pickRecommendationStart,
  resetRecommendationSessionRuntimeForTests,
} from './sessionRuntime.ts'
import { resetContinuousBufferForTests } from './continuousBuffer.ts'
import { sameRecommendationStrategy } from './engine.ts'
import type { RecommendationCatalogPort } from './types.ts'

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

function richTaste(seedTitle: string, seedArtist: string): UserTasteProfile {
  return {
    ...emptyTaste(),
    empty: false,
    tracks: [
      {
        trackId: 'can_seed',
        title: seedTitle,
        artist: seedArtist,
        score: 10,
        signals: { liked: true, plays: 3, skips: 0, completes: 2 },
      },
    ],
  }
}

function mockPort(catalog: Record<string, Track[]>, playable: Set<string>): RecommendationCatalogPort {
  const allHits = [...new Map(
    Object.values(catalog)
      .flat()
      .map((item) => [item.id, item] as const),
  ).values()]
  return {
    sources: [{ id: 'mock-catalog' }],
    async search(_sourceId, query) {
      const exact = catalog[query.trim().toLowerCase()]
      // continuous-random-v1 шлёт разнообразные discovery-запросы — отдаём общий пул.
      return exact && exact.length > 0 ? exact : allHits
    },
    async fetchFeed() {
      return allHits
    },
    async isPlayable(candidate) {
      return playable.has(candidate.id)
    },
  }
}

const seed = track({
  sourceId: 'mock-catalog',
  externalId: 'seed',
  title: 'Seed Song',
  artist: 'Сплин',
})
const rec1 = track({
  sourceId: 'mock-catalog',
  externalId: 'r1',
  title: 'Recommendation 1',
  artist: 'Сплин',
})
const rec2 = track({
  sourceId: 'mock-catalog',
  externalId: 'r2',
  title: 'Recommendation 2',
  artist: 'Сплин',
})
const alien = track({
  sourceId: 'mock-catalog',
  externalId: 'alien',
  title: 'Alien Dump',
  artist: 'Other',
})

/** Каталог-only: library пуста, чтобы ядро не возвращало seed повторно из библиотеки. */
function catalogDeps(queue: PlaybackQueue) {
  return {
    loadProfile: async () => richTaste('Seed Song', 'Сплин'),
    loadLibrary: async () => [] as ContinuationLibraryTrack[],
    createPort: async () =>
      mockPort({ сплин: [rec1, rec2] }, new Set([rec1.id, rec2.id, seed.id])),
    excludedTracks: () =>
      queue.getItems().map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        sourceId: item.sourceId,
        externalId: item.externalId,
      })),
  }
}

function resetAll() {
  resetContinuationSessionForTests()
  resetRecommendationSessionRuntimeForTests()
  resetContinuousBufferForTests()
  setSearchSeedPlaybackEnabled(true)
}

async function seededAdvanceSession(contextType: 'swipe' | 'radio') {
  resetAll()
  const queue = new PlaybackQueue()
  if (contextType === 'radio') {
    queue.setQueue([seed], 0, {
      type: 'radio',
      id: 'my-wave',
      title: 'Моя волна',
      origin: 'recommendations',
    })
    activateRecommendationSession('wave')
  } else {
    queue.setQueue([seed], 0, { type: 'swipe' })
    activateRecommendationSession('swipe')
  }
  const d = catalogDeps(queue)
  const session = new ContinuationSession(
    createSearchRecommendationProvider({
      mode: contextType === 'radio' ? 'wave' : 'swipe',
      ...d,
    }),
  )
  session.prepare(seed, {
    type: 'search-seed',
    query: contextType === 'radio' ? 'my-wave' : 'swipe',
    seedTrackId: seed.id,
  })
  await session.flush()
  return { queue, session }
}

test('A: Swipe start → Rec1 → Next → Rec2', async () => {
  const { queue, session } = await seededAdvanceSession('swipe')
  const first = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(first)
  assert.ok([rec1.id, rec2.id].includes(first!.id))
  assert.notEqual(first!.id, seed.id)
  session.prepare(first!, {
    type: 'search-seed',
    query: 'swipe',
    seedTrackId: first!.id,
  })
  await session.flush()
  const second = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(second)
  assert.ok([rec1.id, rec2.id].includes(second!.id))
  assert.notEqual(second!.id, first!.id)
  assert.equal(queue.getPlaybackContext().type, 'swipe')
  assert.equal(getRecommendationSessionMode(), 'swipe')
})

test('A2: swipe context advances even when mode briefly is search', async () => {
  const { queue, session } = await seededAdvanceSession('swipe')
  setActiveRecommendationMode('search')
  assert.equal(isRecommendationAdvanceContext(queue.getPlaybackContext()), true)
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(next)
  assert.ok([rec1.id, rec2.id].includes(next!.id))
  assert.equal(queue.current()?.id, next!.id)
})

test('UX-10: Play A → LIKE → A stays → UP → B; A remains liked in sys_swipes', async () => {
  resetAll()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  const { getPlaybackQueue } = await import('../playbackQueue/PlaybackQueue.ts')
  const queue = getPlaybackQueue()
  queue.clear()
  commitRecommendationSeed({ mode: 'swipe', track: seed })
  assert.equal(queue.getItems().length, 1)
  assert.equal(queue.current()?.id, seed.id)

  // Simulate LEFT like already applied (canonical liked + inbox).
  useCanonicalLibraryStore.getState().replaceForUser('u1', [
    {
      canonicalTrack: {
        id: 'can_seed',
        title: seed.title,
        artist: seed.artist,
        album: null,
        durationMs: null,
        artworkUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      copies: [
        {
          sourceTrackKey: seed.id,
          canonicalTrackId: 'can_seed',
          sourceId: seed.sourceId,
          externalId: seed.externalId,
          title: seed.title,
          artist: seed.artist,
          album: null,
          durationMs: null,
          artworkUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      state: {
        addedAt: '2026-01-01T00:00:00.000Z',
        lastPlayed: null,
        playCount: 0,
        liked: true,
        likedAt: '2026-01-01T00:00:00.000Z',
        disliked: false,
        skipped: 0,
        notes: '',
        favorite: false,
        hidden: false,
        customMetadata: {},
      },
      catalogIds: [SYS_SWIPES_ID],
    },
  ])

  const likeUp = classifySwipeTrack(seed, 'skip')
  assert.equal(likeUp.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    false,
  )
  assert.equal(queue.current()?.id, seed.id)

  const d = catalogDeps(queue)
  const session = new ContinuationSession(
    createSearchRecommendationProvider({ mode: 'swipe', ...d }),
  )
  session.prepare(seed, {
    type: 'search-seed',
    query: 'swipe',
    seedTrackId: seed.id,
  })
  await session.flush()
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(next)
  assert.ok([rec1.id, rec2.id].includes(next!.id))
  assert.equal(queue.current()?.id, next!.id)
  const liked = useCanonicalLibraryStore.getState().itemsById.can_seed
  assert.equal(liked?.state.liked, true)
  assert.ok(liked?.catalogIds.includes(SYS_SWIPES_ID))
})

test('UX-10: UP without prior like keeps skip semantics then advances', async () => {
  resetAll()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  const { queue, session } = await seededAdvanceSession('swipe')
  const result = classifySwipeTrack(seed, 'skip')
  assert.equal(result.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    true,
  )
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(next)
  assert.ok([rec1.id, rec2.id].includes(next!.id))
})

test('B: Wave start → Rec1 → Next → Rec2', async () => {
  const { queue, session } = await seededAdvanceSession('radio')
  const first = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(first)
  assert.ok([rec1.id, rec2.id].includes(first!.id))
  session.prepare(first!, {
    type: 'search-seed',
    query: 'my-wave',
    seedTrackId: first!.id,
  })
  await session.flush()
  const second = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(second)
  assert.ok([rec1.id, rec2.id].includes(second!.id))
  assert.notEqual(second!.id, first!.id)
  assert.equal(queue.getPlaybackContext().type, 'radio')
  assert.equal(getRecommendationSessionMode(), 'wave')
})

test('C: Search seed → Next → Rec1', async () => {
  resetAll()
  const queue = new PlaybackQueue()
  const d = catalogDeps(queue)
  const session = new ContinuationSession(
    createSearchRecommendationProvider({ mode: 'swipe', ...d }),
  )
  activateRecommendationSession('search', { forceProvider: true, deps: d })
  commitSearchSeedQueue(queue, session, { track: seed, query: 'сплин' })
  await session.flush()
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.ok(next)
  assert.ok([rec1.id, rec2.id].includes(next!.id))
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
  assert.equal(getRecommendationSessionMode(), 'search')
})

test('D: ended and gesture share resolveRecommendationAdvance (wiring)', () => {
  const player = readFileSync(new URL('../audioPlayer/AudioPlayer.ts', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../../pages/Home.tsx', import.meta.url), 'utf8')
  const wave = readFileSync(new URL('../personalRadio/myWaveRuntime.ts', import.meta.url), 'utf8')
  assert.match(player, /playRecommendationAdvance\(true\)/)
  assert.match(player, /playRecommendationAdvance\(false\)/)
  assert.match(player, /resolveRecommendationAdvance/)
  assert.match(home, /intent === 'advance'/)
  assert.match(home, /getAudioPlayer\(\)\.next\(\)/)
  assert.match(home, /pickRecommendationStart/)
  assert.match(home, /commitRecommendationSeed/)
  assert.match(wave, /pickRecommendationStart\(\{ mode: 'wave'/)
  assert.match(wave, /buildPersonalRadio на живом пути не вызывается/)
  assert.equal(/buildPersonalRadio\s*\(/.test(wave), false)
})

test('E: rapid double Next waits for prepare (no false empty stop)', async () => {
  resetAll()
  const queue = new PlaybackQueue()
  queue.setQueue([seed], 0, { type: 'swipe' })
  activateRecommendationSession('swipe')

  let resolveSlow: (value: { track: Track } | null) => void = () => undefined
  const session = new ContinuationSession({
    async prepareContinuation() {
      return await new Promise<{ track: Track } | null>((resolve) => {
        resolveSlow = resolve
      })
    },
  })
  session.prepare(seed, { type: 'search-seed', query: 'swipe', seedTrackId: seed.id })
  assert.equal(session.isBusy(), true)
  assert.equal(consumeRecommendationAdvance(queue, session, { fromEnded: false }), null)

  const firstPromise = enqueueRecommendationAdvance(() =>
    resolveRecommendationAdvance(queue, session, { fromEnded: false }),
  )
  const secondPromise = enqueueRecommendationAdvance(async () => {
    session.setProvider({
      async prepareContinuation() {
        return { track: rec2 }
      },
    })
    return resolveRecommendationAdvance(queue, session, { fromEnded: false })
  })

  resolveSlow({ track: rec1 })
  const first = await firstPromise
  const second = await secondPromise
  assert.equal(first?.id, rec1.id)
  assert.equal(second?.id, rec2.id)
  assert.notEqual(first?.id, second?.id)
  assert.equal(getRecommendationSessionMode(), 'swipe')
})

test('F: Search → Wave → Swipe меняет mode без search dump в очереди', async () => {
  resetAll()
  const live = (await import('../playbackQueue/PlaybackQueue.ts')).getPlaybackQueue()
  const session = new ContinuationSession({
    async prepareContinuation() {
      return { track: rec1 }
    },
  })

  commitSearchSeedQueue(live, session, { track: seed, query: 'сплин' })
  live.insertNext(alien)
  live.insertNext(track({ ...alien, externalId: 'dump2', title: 'Dump 2' }))
  assert.ok(live.getItems().length >= 3)

  activateRecommendationSession('wave', { forceProvider: true })
  commitRecommendationSeed({ mode: 'wave', track: rec1 })
  assert.equal(live.getPlaybackContext().type, 'radio')
  assert.equal(live.getItems().length, 1)
  assert.equal(live.current()?.id, rec1.id)
  assert.equal(getRecommendationSessionMode(), 'wave')

  activateRecommendationSession('swipe', { forceProvider: true })
  commitRecommendationSeed({ mode: 'swipe', track: rec2 })
  assert.equal(live.getPlaybackContext().type, 'swipe')
  assert.equal(live.getItems().length, 1)
  assert.equal(live.current()?.id, rec2.id)
  assert.equal(
    live.getItems().some((item) => item.id === alien.id || item.title.includes('Dump')),
    false,
  )
  assert.equal(getRecommendationSessionMode(), 'swipe')
})

test('G: no sources / empty taste → miss, не персонализированный hit', async () => {
  resetAll()
  const noSources = await pickRecommendationStart({
    mode: 'swipe',
    deps: {
      loadProfile: async () => emptyTaste(),
      loadLibrary: async () => [],
      createPort: async () => ({
        sources: [],
        async search() {
          return []
        },
        async isPlayable() {
          return false
        },
      }),
      excludedTracks: () => [],
    },
  })
  assert.equal(noSources.ok, false)
  if (!noSources.ok) {
    assert.ok(
      noSources.emptyReason === 'no-sources' ||
        noSources.emptyReason === 'no-seed' ||
        noSources.emptyReason === 'exhausted',
    )
  }

  const emptyProfile = await pickRecommendationStart({
    mode: 'wave',
    deps: {
      loadProfile: async () => emptyTaste(),
      loadLibrary: async () => [],
      createPort: async () => mockPort({}, new Set()),
      excludedTracks: () => [],
    },
  })
  assert.equal(emptyProfile.ok, false)
})

test('H: swipe и wave — одинаковая базовая стратегия', () => {
  assert.equal(sameRecommendationStrategy('swipe', 'wave'), true)
  const home = readFileSync(new URL('../../pages/Home.tsx', import.meta.url), 'utf8')
  const wave = readFileSync(new URL('../personalRadio/myWaveRuntime.ts', import.meta.url), 'utf8')
  assert.match(home, /mode: 'swipe'/)
  assert.match(wave, /mode: 'wave'/)
})

test('I: no repeats of same prepared; stale async discarded by generation', async () => {
  resetAll()
  const queue = new PlaybackQueue()
  queue.setQueue([seed], 0, { type: 'swipe' })
  activateRecommendationSession('swipe')
  const session = new ContinuationSession({
    async prepareContinuation() {
      return { track: rec1 }
    },
  })
  session.prepare(seed, { type: 'search-seed', query: 'swipe', seedTrackId: seed.id })
  await session.flush()
  const first = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(first?.id, rec1.id)
  const immediate = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(immediate, null)

  let released = false
  const staleSession = new ContinuationSession({
    async prepareContinuation(_current, _ctx, signal) {
      await new Promise((r) => setTimeout(r, 30))
      if (signal.aborted) {
        return null
      }
      released = true
      return { track: alien }
    },
  })
  staleSession.prepare(rec1, { type: 'search-seed', query: 'swipe', seedTrackId: rec1.id })
  staleSession.cancel()
  await staleSession.flush()
  assert.equal(staleSession.peekPrepared(), null)
  assert.equal(released, false)
})

test('wiring: Home не дампит feed; BottomPlayer next через store→AudioPlayer', () => {
  const home = readFileSync(new URL('../../pages/Home.tsx', import.meta.url), 'utf8')
  assert.match(home, /allowFeedAsQueue: false/)
  const bottom = readFileSync(new URL('../../components/player/BottomPlayer.tsx', import.meta.url), 'utf8')
  assert.match(bottom, /useGlobalPlayerStore\(\(s\) => s\.next\)/)
  assert.match(bottom, /void next\(\)/)
  const store = readFileSync(new URL('../../store/playerStore.ts', import.meta.url), 'utf8')
  assert.match(store, /next: \(\) => audioPlayer\.next\(\)/)
})

test('cold start pickRecommendationStart works for swipe and wave', async () => {
  resetAll()
  const d = {
    loadProfile: async () => richTaste('Seed Song', 'Сплин'),
    loadLibrary: async () => [lib({ ...seed, liked: true, score: 9 })],
    createPort: async () =>
      mockPort({ сплин: [rec1, rec2] }, new Set([seed.id, rec1.id, rec2.id])),
    excludedTracks: () => [],
  }
  const swipe = await pickRecommendationStart({ mode: 'swipe', deps: d })
  assert.equal(swipe.ok, true)
  const wave = await pickRecommendationStart({ mode: 'wave', deps: d })
  assert.equal(wave.ok, true)
  assert.equal(sameRecommendationStrategy('swipe', 'wave'), true)
})
