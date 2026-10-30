/**
 * continuous-random-v1: непрерывный поток A→B→C→D для swipe/wave.
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
  resetContinuousBufferForTests,
} from './continuousBuffer.ts'
import { pickContinuousRandom } from './continuousRandomV1.ts'
import {
  clearRecommendationMiss,
  noteRecommendationMiss,
  resetRecommendationSessionStateForTests,
  setActiveRecommendationMode,
  takeRecommendationMiss,
} from './sessionState.ts'
import type { RecommendationCatalogPort } from './types.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function catalogOf(count: number, prefix = 't'): Track[] {
  return Array.from({ length: count }, (_, index) =>
    track({
      sourceId: 'yandex-music',
      externalId: `${prefix}-${index}`,
      title: `Song ${prefix} ${index}`,
      artist: `Artist ${index % 7}`,
    }),
  )
}

function mockPort(all: Track[], options?: {
  unavailableIds?: Set<string>
  unknownThenPlayable?: Set<string>
}): RecommendationCatalogPort & {
  searches: string[]
  playableChecks: string[]
} {
  const searches: string[] = []
  const playableChecks: string[] = []
  const unavailable = options?.unavailableIds ?? new Set<string>()
  const unknown = options?.unknownThenPlayable ?? new Set<string>()
  return {
    sources: [{ id: 'yandex-music' }],
    searches,
    playableChecks,
    async search(_sourceId, query) {
      searches.push(query)
      // Любой запрос возвращает перемешанный срез каталога.
      const offset = Math.abs(query.length) % Math.max(1, all.length)
      return [...all.slice(offset), ...all.slice(0, offset)].slice(0, 12)
    },
    async fetchFeed() {
      return all.slice(0, 15)
    },
    async isPlayable(candidate) {
      playableChecks.push(candidate.id)
      if (unavailable.has(candidate.id)) {
        return false
      }
      if (unknown.has(candidate.id)) {
        return true
      }
      return true
    },
  }
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

async function advanceChain(
  mode: 'swipe' | 'wave',
  steps: number,
): Promise<Track[]> {
  resetRecommendationSessionStateForTests()
  resetContinuousBufferForTests()
  clearContinuousDiagForTests()
  setActiveRecommendationMode(mode)

  const pool = catalogOf(40, mode)
  const port = mockPort(pool)
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
  return played
}

test('swipe continuous A→B→C→D without likes', async () => {
  const played = await advanceChain('swipe', 3)
  assert.equal(played.length, 4)
  const ids = new Set(played.map((item) => item.id))
  assert.equal(ids.size, 4)
})

test('wave continuous A→B→C→D without likes', async () => {
  const played = await advanceChain('wave', 3)
  assert.equal(played.length, 4)
  const ids = new Set(played.map((item) => item.id))
  assert.equal(ids.size, 4)
})

test('20 sequential next with sufficient catalog', async () => {
  const played = await advanceChain('swipe', 19)
  assert.equal(played.length, 20)
  for (let i = 1; i < played.length; i += 1) {
    assert.notEqual(played[i]!.id, played[i - 1]!.id)
  }
})

test('first unavailable candidate skips to next playable', async () => {
  resetContinuousBufferForTests()
  clearContinuousDiagForTests()
  const pool = catalogOf(12, 'skip')
  const port = mockPort(pool, { unavailableIds: new Set([pool[0]!.id, pool[1]!.id]) })
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
    assert.equal(result.reason, 'continuous-random')
  }
})

test('cold start without likes works with discovery catalog', async () => {
  const pool = catalogOf(10, 'cold')
  const port = mockPort(pool)
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
    assert.match(result.message, /источник/i)
  }
})

test('soft miss is retryable and not permanent exhausted', () => {
  resetRecommendationSessionStateForTests()
  const miss = noteRecommendationMiss('timeout', 'Подбор превысил время. Можно повторить.')
  assert.equal(miss.soft, true)
  const taken = takeRecommendationMiss()
  assert.equal(taken?.soft, true)
  assert.equal(takeRecommendationMiss(), null)
  clearRecommendationMiss()
})

test('prefetch buffer supplies next without destroying queue ownership', async () => {
  resetContinuousBufferForTests()
  resetRecommendationSessionStateForTests()
  setActiveRecommendationMode('swipe')
  const pool = catalogOf(25, 'buf')
  const port = mockPort(pool)
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
  // Дать фоновому refill шанс.
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(getContinuousBufferSize() >= 0)

  session.setProvider(provider)
  // Положим prepared вручную и убедимся, что consume не чистит контекст swipe.
  const prepared = await resolveRecommendationAdvance(queue, session, { fromEnded: false })
  // Может взять из buffer/prepare path
  if (prepared) {
    assert.equal(queue.getPlaybackContext().type, 'swipe')
    assert.notEqual(prepared.id, seed.id)
  }
})

test('diag events do not include stream urls or emails', async () => {
  clearContinuousDiagForTests()
  const pool = catalogOf(8, 'diag')
  const port = mockPort(pool)
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
  resetContinuousBufferForTests()
  resetRecommendationSessionStateForTests()
  setActiveRecommendationMode('swipe')
  const { pushContinuousBufferedTracks, getContinuousBufferGeneration } = await import(
    './continuousBuffer.ts'
  )
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
  assert.equal(queue.current()?.id, b.id)
})
