import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  mergeAndDedupeSearchResults,
  trackDedupeKey,
  type RankedTrack,
} from './mergeResults.ts'

function track(
  partial: Pick<Track, 'id' | 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return { ...partial }
}

test('trackDedupeKey prefers externalId', () => {
  assert.equal(
    trackDedupeKey(
      track({
        id: 'a:1',
        sourceId: 'a',
        externalId: 'XYZ',
        title: 'T',
        artist: 'Art',
      }),
    ),
    'ext:xyz',
  )
})

test('mergeAndDedupeSearchResults keeps higher-priority source on collision', () => {
  const items: RankedTrack[] = [
    {
      track: track({
        id: 'spotify:1',
        sourceId: 'spotify',
        externalId: 'same',
        title: 'Song',
        artist: 'Band',
      }),
      sourcePriority: 10,
      sourceOrder: 0,
      resultIndex: 0,
    },
    {
      track: track({
        id: 'yandex-music:1',
        sourceId: 'yandex-music',
        externalId: 'same',
        title: 'Song',
        artist: 'Band',
      }),
      sourcePriority: 20,
      sourceOrder: 1,
      resultIndex: 0,
    },
  ]
  const merged = mergeAndDedupeSearchResults(items)
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.sourceId, 'spotify')
})

test('mergeAndDedupeSearchResults preserves stable order across pages of one source', () => {
  const items: RankedTrack[] = [2, 0, 1].map((resultIndex) => ({
    track: track({
      id: `s:${resultIndex}`,
      sourceId: 's',
      externalId: `e${resultIndex}`,
      title: `T${resultIndex}`,
      artist: 'A',
    }),
    sourcePriority: 5,
    sourceOrder: 0,
    resultIndex,
  }))
  const merged = mergeAndDedupeSearchResults(items)
  assert.deepEqual(
    merged.map((row) => row.externalId),
    ['e0', 'e1', 'e2'],
  )
})
