/**
 * HOME-CARD-SYNC-04: browse feed vs playback card.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  buildPlaybackDeckTracks,
  isRecommendationHomeDeckContext,
  resolveHomeDeckFocusId,
  resolveHomeDeckTracks,
} from './homeDeck.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

const atl = track({
  sourceId: 'mock-catalog',
  externalId: 'atl',
  title: 'ATL',
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
const hit = track({
  sourceId: 'mock-catalog',
  externalId: 'hit',
  title: 'Search Hit',
  artist: 'Other',
})

test('A/B: swipe playback deck follows queue, not catalog feed', () => {
  const feed = [hit, atl]
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'catalog',
    browseFeed: feed,
    queue: [atl, rec1],
    queueIndex: 1,
    currentTrack: rec1,
    pendingTrack: null,
    context: { type: 'swipe' },
  })
  assert.equal(deck.source, 'playback')
  assert.equal(deck.syncWithPlayer, true)
  assert.equal(deck.advanceAtEnd, true)
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [atl.id, rec1.id],
  )
  assert.equal(deck.tracks.some((item) => item.id === hit.id), false)
})

test('sys_swipes playlist deck syncs for inbox sorting on Home', () => {
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'catalog',
    browseFeed: [hit],
    queue: [atl, rec1],
    queueIndex: 0,
    currentTrack: atl,
    pendingTrack: null,
    context: { type: 'playlist', id: 'sys_swipes', title: 'Свайпы' },
  })
  assert.equal(deck.source, 'playback')
  assert.equal(deck.syncWithPlayer, true)
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [atl.id, rec1.id],
  )
  assert.equal(deck.tracks.some((item) => item.id === hit.id), false)
})

test('C: wave deck uses radio queue', () => {
  const deck = resolveHomeDeckTracks({
    stage: 'wave',
    sessionMode: 'catalog',
    browseFeed: [hit],
    queue: [rec1, rec2],
    queueIndex: 0,
    currentTrack: rec1,
    pendingTrack: null,
    context: { type: 'radio', id: 'my-wave', title: 'Моя волна', origin: 'recommendations' },
  })
  assert.equal(deck.source, 'playback')
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [rec1.id, rec2.id],
  )
})

test('D: search-seed card is seed/queue, not full search hits', () => {
  const hits = [atl, hit, rec1]
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'search',
    browseFeed: hits,
    queue: [atl, rec1],
    queueIndex: 0,
    currentTrack: atl,
    pendingTrack: null,
    context: { type: 'search-seed', query: 'сплин', seedTrackId: atl.id },
  })
  assert.equal(deck.source, 'playback')
  assert.equal(deck.tracks[0]?.id, atl.id)
  assert.equal(deck.tracks.some((item) => item.id === hit.id), false)

  const afterNext = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'search',
    browseFeed: hits,
    queue: [atl, rec1],
    queueIndex: 1,
    currentTrack: rec1,
    pendingTrack: null,
    context: { type: 'search-seed', query: 'сплин', seedTrackId: atl.id },
  })
  assert.equal(
    resolveHomeDeckFocusId({
      pendingTrack: null,
      currentTrack: rec1,
      queue: [atl, rec1],
      queueIndex: 1,
      deckSource: afterNext.source,
    }),
    rec1.id,
  )
})

test('search browse before seed keeps hit list for selection', () => {
  assert.equal(
    isRecommendationHomeDeckContext({
      stage: 'sorting',
      sessionMode: 'search',
      context: { type: 'swipe' },
    }),
    false,
  )
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'search',
    browseFeed: [atl, hit],
    queue: [rec1],
    queueIndex: 0,
    currentTrack: rec1,
    pendingTrack: null,
    context: { type: 'swipe' },
  })
  assert.equal(deck.source, 'browse')
  assert.equal(deck.advanceAtEnd, false)
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [atl.id, hit.id],
  )
})

test('F: focus prefers pending so like targets loading card', () => {
  assert.equal(
    resolveHomeDeckFocusId({
      pendingTrack: rec2,
      currentTrack: rec1,
      queue: [rec1],
      queueIndex: 0,
      deckSource: 'playback',
    }),
    rec2.id,
  )
})

test('G: pending appears in deck before queue update', () => {
  const tracks = buildPlaybackDeckTracks({
    queue: [atl],
    currentTrack: atl,
    pendingTrack: rec1,
    queueIndex: 0,
  })
  assert.deepEqual(
    tracks.map((item) => item.id),
    [atl.id, rec1.id],
  )
})

test('I: playback empty does not fall back to browse feed', () => {
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'search',
    browseFeed: [atl, hit],
    queue: [],
    queueIndex: -1,
    currentTrack: null,
    pendingTrack: null,
    context: { type: 'search-seed', query: 'x', seedTrackId: 'gone' },
  })
  assert.equal(deck.source, 'playback')
  assert.equal(deck.emptyReason, 'playback-empty')
  assert.equal(deck.tracks.length, 0)
})

test('exhausted keeps last focus card, not search hits', () => {
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'search',
    browseFeed: [atl, hit, rec1],
    queue: [atl, rec1, rec2],
    queueIndex: 2,
    currentTrack: rec2,
    pendingTrack: null,
    context: { type: 'search-seed', query: 'сплин', seedTrackId: atl.id },
    recommendationExhausted: true,
  })
  assert.equal(deck.source, 'playback')
  assert.equal(deck.emptyReason, 'playback-exhausted')
  assert.equal(deck.advanceAtEnd, false)
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [rec2.id],
  )
  assert.equal(deck.tracks.some((item) => item.id === hit.id), false)
})

test('J: album context stays browse (sequential queue untouched)', () => {
  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'catalog',
    browseFeed: [atl, hit],
    queue: [rec1, rec2],
    queueIndex: 0,
    currentTrack: rec1,
    pendingTrack: null,
    context: { type: 'album', id: 'a1', title: 'Album' },
  })
  assert.equal(deck.source, 'browse')
  assert.equal(deck.advanceAtEnd, false)
  assert.deepEqual(
    deck.tracks.map((item) => item.id),
    [atl.id, hit.id],
  )
})

test('wiring: Home uses resolveHomeDeckTracks; SwipeDeck advanceAtEnd', () => {
  const home = readFileSync(new URL('../../pages/Home.tsx', import.meta.url), 'utf8')
  const deck = readFileSync(new URL('../../components/SwipeDeck.tsx', import.meta.url), 'utf8')
  assert.match(home, /resolveHomeDeckTracks/)
  assert.match(home, /advanceAtEnd=\{sortingDeck\.advanceAtEnd\}/)
  assert.match(home, /playback-empty/)
  assert.match(deck, /advanceAtEnd/)
  assert.match(deck, /SwipeDeck\.advanceAtEnd/)
  assert.match(deck, /last-card→AudioPlayer\.next/)
})
