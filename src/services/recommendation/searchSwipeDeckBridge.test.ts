import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  isRecommendationHomeDeckContext,
  resolveHomeDeckFocusId,
  resolveHomeDeckTracks,
} from './homeDeck.ts'

function track(id: string, title = id): Track {
  return {
    id,
    sourceId: 'dev-acceptance',
    externalId: id,
    title,
    artist: 'Artist',
  }
}

test('search-seed on / uses playback deck (seed first), not browse search hits', () => {
  const seed = track('seed', 'Seed Song')
  const hitB = track('hit-b', 'Other Hit')
  const next = track('rec-1', 'Recommendation 1')

  const deck = resolveHomeDeckTracks({
    stage: 'sorting',
    sessionMode: 'catalog',
    browseFeed: [hitB, seed],
    queue: [seed, next],
    queueIndex: 0,
    currentTrack: seed,
    pendingTrack: null,
    context: {
      type: 'search-seed',
      query: 'Сплин',
      seedTrackId: seed.id,
      hardExcludeHits: [
        { sourceId: seed.sourceId, externalId: seed.externalId },
        { sourceId: hitB.sourceId, externalId: hitB.externalId },
      ],
    },
  })

  assert.equal(deck.source, 'playback')
  assert.equal(deck.syncWithPlayer, true)
  assert.equal(deck.tracks[0]?.id, 'seed')
  assert.equal(
    deck.tracks.some((item) => item.id === 'hit-b'),
    false,
  )
  assert.equal(
    isRecommendationHomeDeckContext({
      stage: 'sorting',
      sessionMode: 'catalog',
      context: {
        type: 'search-seed',
        query: 'Сплин',
        seedTrackId: seed.id,
      },
    }),
    true,
  )
})

test('pending search switch focuses pending card, not previous audible swipe track', () => {
  const oldSwipe = track('swipe-old')
  const seed = track('seed-new')
  const focus = resolveHomeDeckFocusId({
    pendingTrack: seed,
    currentTrack: oldSwipe,
    queue: [seed],
    queueIndex: 0,
    deckSource: 'playback',
  })
  assert.equal(focus, 'seed-new')
})
