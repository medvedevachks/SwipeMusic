import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSearchSeedHardExclusions,
  parsePlaybackContext,
} from '../../types/playbackContext.ts'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { ContinuationSession } from './ContinuationSession.ts'
import {
  buildSearchHitExclusions,
  commitSearchSeedQueue,
} from './searchSeedPlayback.ts'
import type { Track } from '../../types/track.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

test('buildSearchHitExclusions covers id / copy / title fields', () => {
  const hits = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'atl',
      title: 'ATL',
      artist: 'Сплин',
    }),
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-1',
      title: 'Recommendation 1',
      artist: 'Сплин',
    }),
  ]
  const exclusions = buildSearchHitExclusions(hits)
  assert.equal(exclusions.length, 2)
  assert.equal(exclusions[0]?.id, hits[0]!.id)
  assert.equal(exclusions[0]?.sourceId, 'dev-acceptance')
  assert.equal(exclusions[0]?.externalId, 'atl')
})

test('commitSearchSeedQueue stores hardExcludeHits; swipe context clears them', () => {
  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  const hits = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'seed',
      title: 'Seed Song',
      artist: 'Сплин',
    }),
    track({
      sourceId: 'dev-acceptance',
      externalId: 'atl',
      title: 'ATL',
      artist: 'Сплин',
    }),
    track({
      sourceId: 'dev-acceptance',
      externalId: 'rec-1',
      title: 'Recommendation 1',
      artist: 'Сплин',
    }),
  ]
  const ctx = commitSearchSeedQueue(queue, session, {
    track: hits[1]!,
    query: 'Сплин',
    searchHits: hits,
  })
  assert.equal(ctx.hardExcludeHits?.length, 3)
  assert.equal(getSearchSeedHardExclusions(queue.getPlaybackContext()).length, 3)

  queue.setQueue([hits[1]!], 0, { type: 'swipe' })
  assert.equal(getSearchSeedHardExclusions(queue.getPlaybackContext()).length, 0)

  queue.setQueue([hits[1]!], 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(getSearchSeedHardExclusions(queue.getPlaybackContext()).length, 0)
})

test('reload parsePlaybackContext keeps hardExcludeHits for active search-seed', () => {
  const hits = [
    {
      id: 'dev-acceptance:atl',
      title: 'ATL',
      artist: 'Сплин',
      sourceId: 'dev-acceptance',
      externalId: 'atl',
    },
    {
      id: 'dev-acceptance:rec-1',
      title: 'Recommendation 1',
      artist: 'Сплин',
      sourceId: 'dev-acceptance',
      externalId: 'rec-1',
    },
  ]
  const restored = parsePlaybackContext({
    type: 'search-seed',
    query: 'Сплин',
    seedTrackId: 'dev-acceptance:atl',
    hardExcludeHits: hits,
  })
  assert.equal(restored.type, 'search-seed')
  if (restored.type === 'search-seed') {
    assert.equal(restored.hardExcludeHits?.length, 2)
    assert.equal(restored.hardExcludeHits?.[1]?.externalId, 'rec-1')
  }
  assert.equal(getSearchSeedHardExclusions(restored).length, 2)
})

test('new search seed replaces previous hard exclusions', () => {
  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  const firstHits = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'atl',
      title: 'ATL',
      artist: 'Сплин',
    }),
  ]
  const secondHits = [
    track({
      sourceId: 'dev-acceptance',
      externalId: 'kino-blood',
      title: 'Группа крови',
      artist: 'Кино',
    }),
  ]
  commitSearchSeedQueue(queue, session, {
    track: firstHits[0]!,
    query: 'Сплин',
    searchHits: firstHits,
  })
  commitSearchSeedQueue(queue, session, {
    track: secondHits[0]!,
    query: 'Кино',
    searchHits: secondHits,
  })
  const excluded = getSearchSeedHardExclusions(queue.getPlaybackContext())
  assert.equal(excluded.length, 1)
  assert.equal(excluded[0]?.externalId, 'kino-blood')
})
