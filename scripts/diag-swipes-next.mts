/**
 * DEV diagnostic: continuous SWIPES advance against dev-acceptance catalog.
 * Run: node --experimental-strip-types scripts/diag-swipes-next.mts
 */
import assert from 'node:assert/strict'
import { buildDevAcceptanceCatalog } from '../src/sources/adapters/dev-acceptance/catalog.ts'
import {
  collectContinuousPlayableBatch,
  pickContinuousRandom,
} from '../src/services/recommendation/continuousRandomV1.ts'
import {
  clearContinuousDiscoveryRuntime,
  ensureContinuousDiscoverySession,
  getContinuousPoolSize,
  getContinuousDiscoverySnapshot,
} from '../src/services/recommendation/continuousSession.ts'
import {
  invalidateContinuousBuffer,
  resetContinuousBufferForTests,
  getContinuousBufferSize,
} from '../src/services/recommendation/continuousBuffer.ts'
import type { ContinuationLibraryTrack } from '../src/services/continuation/libraryContinuation.ts'
import type { Track } from '../src/types/track.ts'

const catalog = buildDevAcceptanceCatalog()
assert.ok(catalog.length >= 15, `need >=15 catalog tracks, got ${catalog.length}`)

function toLibrary(track: Track): ContinuationLibraryTrack {
  return {
    id: track.id,
    sourceId: track.sourceId,
    externalId: track.externalId!,
    title: track.title,
    artist: track.artist,
    artistId: null,
    liked: true,
    disliked: false,
    hidden: false,
    favorite: false,
    inCatalog: false,
    score: 1,
    lastPlayed: null,
  }
}

const port = {
  sources: [{ id: 'dev-acceptance' }],
  search: async (_sourceId: string, query: string) => {
    const needle = query.trim().toLowerCase()
    return catalog.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.artist.toLowerCase().includes(needle),
    )
  },
  fetchFeed: async () => catalog.slice(0, 40),
  searchPage: async (_sourceId: string, query: string) => ({
    tracks: await port.search('dev-acceptance', query, new AbortController().signal),
    nextCursor: null,
  }),
  fetchFeedPage: async () => ({
    tracks: catalog.slice(0, 40),
    nextCursor: null,
  }),
  isPlayable: async () => true,
}

clearContinuousDiscoveryRuntime('diag')
resetContinuousBufferForTests()
ensureContinuousDiscoverySession('swipe', { resetLanes: true })

const seed = catalog.find((t) => t.externalId === 'kino-blood')!
const library = catalog.map(toLibrary)

console.log('catalog', catalog.length, 'seed', seed.id)

const batch = await collectContinuousPlayableBatch(
  {
    mode: 'swipe',
    current: seed,
    taste: null,
    excluded: [],
    library,
    port,
    strategy: 'continuous-random',
  },
  10,
)

console.log('batch', batch.length, batch.map((t) => t.externalId).join(','))
console.log('pool', getContinuousPoolSize(), 'buffer', getContinuousBufferSize())
console.log('snap', JSON.stringify(getContinuousDiscoverySnapshot(), null, 2))

const picks: string[] = []
let current = seed
for (let i = 0; i < 12; i += 1) {
  const result = await pickContinuousRandom({
    mode: 'swipe',
    current,
    taste: null,
    excluded: picks.map((id) => {
      const t = catalog.find((c) => c.id === id)!
      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        sourceId: t.sourceId,
        externalId: t.externalId,
      }
    }),
    library,
    port,
    strategy: 'continuous-random',
  })
  if (!result.ok) {
    console.log('pick fail at', i, result.emptyReason, result.message)
    break
  }
  picks.push(result.track.id)
  current = result.track
  console.log('pick', i + 1, result.track.externalId)
}

console.log('total picks', picks.length)
invalidateContinuousBuffer('diag-done')
