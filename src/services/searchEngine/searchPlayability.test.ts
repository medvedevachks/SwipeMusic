import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SEARCH_PLAYABILITY_TAG,
  mergeProviderWarnings,
  resolveSearchTrackPlayability,
  searchPlayabilityLabel,
  withSearchPlayabilityTags,
} from './searchPlayability.ts'

test('resolveSearchTrackPlayability stays unknown without tags', () => {
  assert.equal(resolveSearchTrackPlayability({}), 'unknown')
  assert.equal(resolveSearchTrackPlayability({ tags: [] }), 'unknown')
  assert.equal(resolveSearchTrackPlayability({ tags: ['genre:pop'] }), 'unknown')
})

test('resolveSearchTrackPlayability reads explicit tags only', () => {
  assert.equal(
    resolveSearchTrackPlayability({
      tags: [SEARCH_PLAYABILITY_TAG.PLAYABLE],
    }),
    'playable',
  )
  assert.equal(
    resolveSearchTrackPlayability({
      tags: [SEARCH_PLAYABILITY_TAG.UNAVAILABLE],
    }),
    'unavailable',
  )
  // unavailable wins if both somehow present
  assert.equal(
    resolveSearchTrackPlayability({
      tags: [
        SEARCH_PLAYABILITY_TAG.PLAYABLE,
        SEARCH_PLAYABILITY_TAG.UNAVAILABLE,
      ],
    }),
    'unavailable',
  )
})

test('searchPlayabilityLabel hides unknown', () => {
  assert.equal(searchPlayabilityLabel('playable'), 'Доступно')
  assert.equal(searchPlayabilityLabel('unavailable'), 'Недоступно')
  assert.equal(searchPlayabilityLabel('unknown'), null)
})

test('withSearchPlayabilityTags only applies boolean provider flags', () => {
  assert.deepEqual(withSearchPlayabilityTags(['a'], undefined), ['a'])
  assert.deepEqual(withSearchPlayabilityTags(undefined, null), undefined)
  assert.deepEqual(withSearchPlayabilityTags(['a'], true), [
    'a',
    SEARCH_PLAYABILITY_TAG.PLAYABLE,
  ])
  assert.deepEqual(
    withSearchPlayabilityTags([SEARCH_PLAYABILITY_TAG.PLAYABLE], false),
    [SEARCH_PLAYABILITY_TAG.UNAVAILABLE],
  )
})

test('mergeProviderWarnings dedupes and keeps order', () => {
  assert.deepEqual(
    mergeProviderWarnings(['A: fail', 'B: fail'], ['A: fail', 'C: fail']),
    ['A: fail', 'B: fail', 'C: fail'],
  )
})
