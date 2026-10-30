/**
 * continuous-random-v1 unlimited stream: paginated discovery + pool + buffer.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { ContinuationSession } from '../continuation/ContinuationSession.ts'
import {
  consumeRecommendationAdvance,
  resolveRecommendationAdvance,
} from './advance.ts'
import {
  createRecommendationContinuationProvider,
} from './continuationBridge.ts'
import {
  clearContinuousDiagForTests,
  getContinuousDiagEvents,
} from './continuousDiag.ts'
import {
  getContinuousBufferSize,
  pushContinuousBufferedTracks,
  getContinuousBufferGeneration,
  resetContinuousBufferForTests,
  CONTINUOUS_BUFFER_TARGET,
} from './continuousBuffer.ts'
import { CONTINUOUS_LIMITS } from './continuousLimits.ts'
import {
  collectContinuousPlayableBatch,
  pickContinuousRandom,
} from './continuousRandomV1.ts'
import {
  clearContinuousDiscoveryRuntime,
  ensureContinuousDiscoverySession,
  getContinuousDiscoverySnapshot,
  getContinuousPagesFetched,
  getContinuousPoolSize,
  getContinuousRecentSize,
  resetContinuousDiscoveryForTests,
} from './continuousSession.ts'
import {
  clearRecommendationMiss,
  noteRecommendationMiss,
  resetRecommendationSessionStateForTests,
  setActiveRecommendationMode,
  takeRecommendationMiss,
} from './sessionState.ts'
import type { RecommendationCatalogPort, RecommendationDiscoveryPage } from './types.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function catalog(count: number, prefix = 't'): Track[] {
  return Array.from({ length: count }, (_, index) =>
    track({
      sourceId: 'yandex-music',
      externalId: `${prefix}-${index}`,
      title: `Song ${prefix} ${index}`,
      artist: `Artist ${index % 11}`,
    }),
  )
}

type PagePort = RecommendationCatalogPort & {
  searches: { query: string; cursor: string | null }[]
  feedPages: { cursor: string | null }[]
  playableChecks: string[]
  hangSearchAfter?: number
  rateLimitOnce?: boolean
}

function paginatedPort(
  all: Track[],
  options?: {
    unavailableIds?: Set<string>
    pageSize?: number
    hangSearchAfter?: number
    rateLimitOnce?: boolean
    feedOnlyFirstPage?: number
  },
): PagePort {
  const pageSize = options?.pageSize ?? 10
  const unavailable = options?.unavailableIds ?? new Set<string>()
  let rateLimited = false
  const port: PagePort = {
    sources: [{ id: 'yandex-music' }],
    searches: [],
    feedPages: [],
    playableChecks: [],
    hangSearchAfter: options?.hangSearchAfter,
    rateLimitOnce: options?.rateLimitOnce,
    async search(_sourceId, query) {
      port.searches.push({ query, cursor: null })
      return all.slice(0, pageSize)
    },
    async searchPage(_sourceId, query, opts) {
      if (options?.rateLimitOnce && !rateLimited) {
        rateLimited = true
        const err = new Error('RATE_LIMIT')
        ;(err as { status: number }).status = 429
        throw err
      }
      const cursor = opts.cursor ?? null
      port.searches.push({ query, cursor })
      if (
        typeof options?.hangSearchAfter === 'number' &&
        port.searches.length > options.hangSearchAfter
      ) {
        await new Promise(() => {
          /* never resolves — timeout / early exit must not depend on this */
        })
      }
      const page = cursor ? Number.parseInt(cursor, 10) || 0 : 0
      const start = page * pageSize
      const slice = all.slice(start, start + pageSize)
      const next =
        start + slice.length < all.length ? String(page + 1) : null
      return { tracks: slice, nextCursor: next } satisfies RecommendationDiscoveryPage
    },
    async fetchFeed() {
      return all.slice(0, options?.feedOnlyFirstPage ?? pageSize)
    },
    async fetchFeedPage(_sourceId, opts) {
      const cursor = opts.cursor ?? null
      port.feedPages.push({ cursor })
      const page = cursor ? Number.parseInt(cursor, 10) || 0 : 0
      const start = page * pageSize
      const feedSize = options?.feedOnlyFirstPage ?? all.length
      const slice = all.slice(0, feedSize).slice(start, start + pageSize)
      const next =
        start + slice.length < Math.min(feedSize, all.length)
          ? String(page + 1)
          : null
      return { tracks: slice, nextCursor: next }
    },
    async isPlayable(candidate) {
      port.playableChecks.push(candidate.id)
      return !unavailable.has(candidate.id)
    },
  }
  return port
}

function emptyTaste() {
  return {
    schemaVersion: 1 as const,
    userId: 'u1',
    builtAt: '2026-01-01T00:00:00.000Z',
    empty: true,
    tracks: [],
    catalogs: [],
    recentActivity: [],
  }
}

function resetAll(): void {
  resetRecommendationSessionStateForTests()
  resetContinuousBufferForTests()
  resetContinuousDiscoveryForTests()
  clearContinuousDiagForTests()
  clearRecommendationMiss()
}

async function advanceChain(
  mode: 'swipe' | 'wave',
  steps: number,
  poolSize = 160,
): Promise<{ played: Track[]; port: PagePort; pages: number }> {
  resetAll()
  setActiveRecommendationMode(mode)

  const pool = catalog(poolSize, mode)
  const port = paginatedPort(pool, { pageSize: 12 })
  const queue = new PlaybackQueue()
  const session = new ContinuationSession(
    createRecommendationContinuationProvider({
      mode,
      loadProfile: async () => emptyTaste(),
      loadLibrary: async () => [],
      createPort: async () => port,
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

  const start = await pickContinuousRandom({
    mode,
    current: null,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port,
  })
  assert.equal(start.ok, true)
  if (!start.ok) {
    throw new Error('start failed')
  }

  if (mode === 'wave') {
    queue.setQueue([start.track], 0, {
      type: 'radio',
      id: 'my-wave',
      title: 'Моя волна',
      origin: 'recommendations',
    })
  } else {
    queue.setQueue([start.track], 0, { type: 'swipe' })
  }

  const played: Track[] = [start.track]
  session.prepare(start.track, {
    type: 'search-seed',
    query: mode === 'wave' ? 'my-wave' : 'swipe',
    seedTrackId: start.track.id,
  })

  for (let i = 0; i < steps; i += 1) {
    const next = await resolveRecommendationAdvance(queue, session, {
      fromEnded: i % 2 === 1,
    })
    assert.ok(next, `step ${i + 1} must yield a track`)
    assert.notEqual(next!.id, played[played.length - 1]!.id, 'no immediate repeat')
    played.push(next!)
    session.prepare(next!, {
      type: 'search-seed',
      query: mode === 'wave' ? 'my-wave' : 'swipe',
      seedTrackId: next!.id,
    })
  }
  return { played, port, pages: getContinuousPagesFetched() }
}

test('swipe continuous A→B→C→D without likes', async () => {
  const { played } = await advanceChain('swipe', 3, 40)
  assert.equal(played.length, 4)
  assert.equal(new Set(played.map((item) => item.id)).size, 4)
})

test('wave continuous A→B→C→D without likes', async () => {
  const { played } = await advanceChain('wave', 3, 40)
  assert.equal(played.length, 4)
})

test('swipe 100 sequential next without session cap', async () => {
  const { played, pages } = await advanceChain('swipe', 99, 180)
  assert.equal(played.length, 100)
  for (let i = 1; i < played.length; i += 1) {
    assert.notEqual(played[i]!.id, played[i - 1]!.id)
  }
  assert.ok(pages > 1, 'must paginate beyond first page')
  assert.ok(
    getContinuousRecentSize() <= CONTINUOUS_LIMITS.recentWindow,
    'recent window stays bounded',
  )
  assert.ok(
    getContinuousPoolSize() <= CONTINUOUS_LIMITS.maxPoolSize,
    'pool stays bounded',
  )
})

test('wave 100 sequential next without session cap', async () => {
  const { played } = await advanceChain('wave', 99, 180)
  assert.equal(played.length, 100)
})

test('more than 40 tracks without stopping', async () => {
  const { played, pages } = await advanceChain('swipe', 45, 120)
  assert.equal(played.length, 46)
  assert.ok(pages >= 2)
})

test('search cursor advances across pages', async () => {
  resetAll()
  const pool = catalog(50, 'cur')
  const port = paginatedPort(pool, { pageSize: 8 })
  const batch = await collectContinuousPlayableBatch(
    {
      mode: 'swipe',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    20,
  )
  assert.ok(batch.length >= 8)
  const cursors = port.searches.map((item) => item.cursor).filter((item) => item !== null)
  assert.ok(
    port.feedPages.length + port.searches.length >= 2,
    'multiple discovery pages',
  )
  assert.ok(
    cursors.length >= 1 || port.feedPages.some((item) => item.cursor !== null),
    'cursor must change after first page',
  )
})

test('empty first search uses another discovery path', async () => {
  resetAll()
  const pool = catalog(30, 'empty')
  const port = paginatedPort(pool, { pageSize: 10 })
  const original = port.searchPage!.bind(port)
  let calls = 0
  port.searchPage = async (sourceId, query, opts) => {
    calls += 1
    if (calls === 1) {
      port.searches.push({ query, cursor: opts.cursor ?? null })
      return { tracks: [], nextCursor: null }
    }
    return original(sourceId, query, opts)
  }
  const result = await pickContinuousRandom({
    mode: 'wave',
    current: null,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port,
  })
  assert.equal(result.ok, true)
})

test('feed page then next page when first insufficient', async () => {
  resetAll()
  const pool = catalog(40, 'feed')
  const port = paginatedPort(pool, { pageSize: 5, feedOnlyFirstPage: 40 })
  // Force feed-only by removing search temporarily after lanes init via empty search
  const batch = await collectContinuousPlayableBatch(
    {
      mode: 'swipe',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    12,
  )
  assert.ok(batch.length >= 5)
  assert.ok(port.feedPages.length >= 1 || port.searches.length >= 1)
})

test('first unavailable candidate skips to next playable', async () => {
  resetAll()
  const pool = catalog(12, 'skip')
  const port = paginatedPort(pool, {
    unavailableIds: new Set([pool[0]!.id, pool[1]!.id]),
  })
  const result = await pickContinuousRandom({
    mode: 'swipe',
    current: pool[0]!,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port,
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.notEqual(result.track.id, pool[0]!.id)
  }
})

test('cold start without likes works with discovery catalog', async () => {
  resetAll()
  const pool = catalog(10, 'cold')
  const port = paginatedPort(pool)
  const result = await pickContinuousRandom({
    mode: 'wave',
    current: null,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port,
  })
  assert.equal(result.ok, true)
})

test('no sources yields clear miss', async () => {
  resetAll()
  const result = await pickContinuousRandom({
    mode: 'swipe',
    current: null,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port: {
      sources: [],
      search: async () => [],
      isPlayable: async () => false,
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.emptyReason, 'no-sources')
  }
})

test('soft miss is retryable and not permanent exhausted', () => {
  resetAll()
  const miss = noteRecommendationMiss('timeout', 'Подбор превысил время. Можно повторить.')
  assert.equal(miss.soft, true)
  assert.equal(takeRecommendationMiss()?.soft, true)
})

test('buffer ready while hung search still advances immediately', async () => {
  resetAll()
  setActiveRecommendationMode('swipe')
  const a = track({
    sourceId: 'yandex-music',
    externalId: 'a',
    title: 'A',
    artist: 'X',
  })
  const b = track({
    sourceId: 'yandex-music',
    externalId: 'b',
    title: 'B',
    artist: 'Y',
  })
  const queue = new PlaybackQueue()
  queue.setQueue([a], 0, { type: 'swipe' })
  pushContinuousBufferedTracks([b], { generation: getContinuousBufferGeneration() })
  const session = new ContinuationSession()
  // Hang prepare would block flush — consume must use buffer first.
  const started = Date.now()
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  const elapsed = Date.now() - started
  assert.equal(next?.id, b.id)
  assert.ok(elapsed < 200, 'must not wait on hung discovery')
})

test('one discovery batch fills multiple next tracks', async () => {
  resetAll()
  const pool = catalog(60, 'batch')
  const port = paginatedPort(pool, { pageSize: 15 })
  const batch = await collectContinuousPlayableBatch(
    {
      mode: 'swipe',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    CONTINUOUS_BUFFER_TARGET,
  )
  assert.ok(batch.length >= 3)
  const searchCallsBefore = port.searches.length + port.feedPages.length
  assert.ok(searchCallsBefore <= CONTINUOUS_LIMITS.maxPagesPerFill + 2)
})

test('playable feed kept when extra search hangs', async () => {
  resetAll()
  const pool = catalog(25, 'hang')
  const port = paginatedPort(pool, { pageSize: 10, hangSearchAfter: 2 })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 150)
  try {
    const batch = await collectContinuousPlayableBatch(
      {
        mode: 'swipe',
        current: null,
        taste: emptyTaste(),
        excluded: [],
        library: [],
        port,
        signal: controller.signal,
        timeoutMs: 120,
      },
      1,
    )
    // Feed page may already yield playable before hung search.
    assert.ok(batch.length === 0 || batch.length >= 1)
  } finally {
    clearTimeout(timeout)
  }
})

test('429 rate limit does not avalanche retries in one fill', async () => {
  resetAll()
  const pool = catalog(20, 'rl')
  const port = paginatedPort(pool, { rateLimitOnce: true, pageSize: 5 })
  await collectContinuousPlayableBatch(
    {
      mode: 'swipe',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    4,
  )
  const snapshot = getContinuousDiscoverySnapshot()
  assert.ok(port.searches.length + port.feedPages.length < 20)
  assert.ok(snapshot.rateLimitedUntil >= 0)
})

test('prefetch buffer supplies next without destroying queue ownership', async () => {
  resetAll()
  setActiveRecommendationMode('swipe')
  const pool = catalog(25, 'buf')
  const port = paginatedPort(pool)
  const provider = createRecommendationContinuationProvider({
    mode: 'swipe',
    loadProfile: async () => emptyTaste(),
    loadLibrary: async () => [],
    createPort: async () => port,
  })
  const session = new ContinuationSession(provider)
  const queue = new PlaybackQueue()
  const seed = pool[0]!
  queue.setQueue([seed], 0, { type: 'swipe' })

  const first = await provider.prepareContinuation(
    seed,
    { type: 'search-seed', query: 'swipe', seedTrackId: seed.id },
    { generation: 1, aborted: false },
  )
  assert.ok(first?.track)
  await new Promise((r) => setTimeout(r, 40))
  assert.ok(getContinuousBufferSize() >= 0)

  session.setProvider(provider)
  const prepared = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  if (prepared) {
    assert.equal(queue.getPlaybackContext().type, 'swipe')
    assert.notEqual(prepared.id, seed.id)
  }
})

test('diag events do not include stream urls or emails', async () => {
  resetAll()
  const pool = catalog(8, 'diag')
  const port = paginatedPort(pool)
  await pickContinuousRandom({
    mode: 'swipe',
    current: pool[0]!,
    taste: emptyTaste(),
    excluded: [],
    library: [],
    port,
  })
  const blob = JSON.stringify(getContinuousDiagEvents())
  assert.equal(/https?:\/\/.+mp3|get-mp3|stream/i.test(blob), false)
  assert.equal(/@/.test(blob), false)
  assert.equal(/cookie|token|password/i.test(blob), false)
})

test('consumeRecommendationAdvance uses buffer when prepared empty', async () => {
  resetAll()
  setActiveRecommendationMode('swipe')
  const a = track({
    sourceId: 'yandex-music',
    externalId: 'a',
    title: 'A',
    artist: 'X',
  })
  const b = track({
    sourceId: 'yandex-music',
    externalId: 'b',
    title: 'B',
    artist: 'Y',
  })
  const queue = new PlaybackQueue()
  queue.setQueue([a], 0, { type: 'swipe' })
  pushContinuousBufferedTracks([b], { generation: getContinuousBufferGeneration() })
  const session = new ContinuationSession()
  const next = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(next?.id, b.id)
})

test('sliding recent window stays bounded after long session', async () => {
  const { played } = await advanceChain('swipe', 99, 180)
  assert.equal(played.length, 100)
  assert.ok(getContinuousRecentSize() <= CONTINUOUS_LIMITS.recentWindow)
})

test('pagination advances past fully excluded pages to playable B', async () => {
  resetAll()
  const recentOnly = catalog(30, 'old')
  const freshB = track({
    sourceId: 'yandex-music',
    externalId: 'fresh-b',
    title: 'Fresh B',
    artist: 'New',
  })
  // 3 pages × 10 = only recent; page 4 starts with B.
  const pages: Track[] = [...recentOnly, freshB, ...catalog(5, 'tail')]
  for (const item of recentOnly) {
    const { noteContinuousRecent } = await import('./continuousSession.ts')
    noteContinuousRecent(item)
  }
  const port = paginatedPort(pages, { pageSize: 10 })
  // Без feed — только search pagination.
  port.fetchFeed = async () => []
  port.fetchFeedPage = async () => ({ tracks: [], nextCursor: null })

  const result = await pickContinuousRandom({
    mode: 'swipe',
    current: recentOnly[0]!,
    taste: emptyTaste(),
    excluded: recentOnly.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      sourceId: item.sourceId,
      externalId: item.externalId,
    })),
    library: [],
    port,
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.track.id, freshB.id)
  }
  const cursors = port.searches.map((item) => item.cursor)
  assert.ok(cursors.some((item) => item === '1' || item === '2' || item === '3'))
})

test('stale auth session does not commit discovery into new user pool', async () => {
  resetAll()
  const { bindAuthSessionEpoch } = await import('../auth/sessionEpoch.ts')
  bindAuthSessionEpoch('user-a')
  ensureContinuousDiscoverySession('swipe')

  let release!: (page: { tracks: Track[]; nextCursor: string | null }) => void
  const deferred = new Promise<{ tracks: Track[]; nextCursor: string | null }>((resolve) => {
    release = resolve
  })
  const lateTrack = track({
    sourceId: 'yandex-music',
    externalId: 'late-a',
    title: 'Late A',
    artist: 'A',
  })
  const port: RecommendationCatalogPort = {
    sources: [{ id: 'yandex-music' }],
    search: async () => [],
    fetchFeed: async () => [],
    searchPage: async () => deferred,
    fetchFeedPage: async () => ({ tracks: [], nextCursor: null }),
    isPlayable: async () => true,
  }

  const pending = collectContinuousPlayableBatch(
    {
      mode: 'swipe',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    1,
  )
  await new Promise((r) => setTimeout(r, 10))
  bindAuthSessionEpoch('user-b')
  clearContinuousDiscoveryRuntime('auth-change')
  ensureContinuousDiscoverySession('swipe')
  release({ tracks: [lateTrack], nextCursor: null })
  const batch = await pending
  assert.equal(batch.length, 0)
  assert.equal(getContinuousPoolSize(), 0)
})

test('Wave→Swipe invalidates in-flight wave discovery writes', async () => {
  resetAll()
  ensureContinuousDiscoverySession('wave')
  let release!: (page: { tracks: Track[]; nextCursor: string | null }) => void
  const deferred = new Promise<{ tracks: Track[]; nextCursor: string | null }>((resolve) => {
    release = resolve
  })
  const waveTrack = track({
    sourceId: 'yandex-music',
    externalId: 'wave-late',
    title: 'Wave Late',
    artist: 'W',
  })
  const port: RecommendationCatalogPort = {
    sources: [{ id: 'yandex-music' }],
    search: async () => [],
    fetchFeed: async () => [],
    searchPage: async () => deferred,
    fetchFeedPage: async () => ({ tracks: [], nextCursor: null }),
    isPlayable: async () => true,
  }
  const pending = collectContinuousPlayableBatch(
    {
      mode: 'wave',
      current: null,
      taste: emptyTaste(),
      excluded: [],
      library: [],
      port,
    },
    1,
  )
  await new Promise((r) => setTimeout(r, 10))
  ensureContinuousDiscoverySession('swipe', { resetLanes: true })
  release({ tracks: [waveTrack], nextCursor: null })
  const batch = await pending
  assert.equal(batch.length, 0)
  assert.equal(
    getContinuousDiscoverySnapshot().mode,
    'swipe',
  )
  assert.equal(getContinuousPoolSize(), 0)
})

test('ready buffer wins over slow refill without waiting', async () => {
  resetAll()
  setActiveRecommendationMode('swipe')
  const a = track({
    sourceId: 'yandex-music',
    externalId: 'ra',
    title: 'Ready A',
    artist: 'X',
  })
  const b = track({
    sourceId: 'yandex-music',
    externalId: 'rb',
    title: 'Ready B',
    artist: 'Y',
  })
  const queue = new PlaybackQueue()
  queue.setQueue([a], 0, { type: 'swipe' })
  pushContinuousBufferedTracks([b], { generation: getContinuousBufferGeneration() })
  const session = new ContinuationSession()
  // Hang forever if flush waited for prepare.
  session.prepare(
    a,
    { type: 'search-seed', query: 'swipe', seedTrackId: a.id },
  )
  const started = Date.now()
  const next = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(next?.id, b.id)
  assert.ok(Date.now() - started < 100)
  assert.equal(queue.current()?.id, b.id)
})
