import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../types/playbackAvailability.ts'
import type { CanonicalPlaybackAvailability } from '../../types/playbackAvailability.ts'
import {
  findPlaybackAvailabilityForSearchTrack,
  getPlaybackAvailabilitySourceIndex,
  providerWarningsList,
  reconcileProviderWarningsBySource,
  resetPlaybackAvailabilitySourceIndexForTests,
  resolveSearchTrackPlayability,
  resolveSearchTrackPlayabilityFromAvailability,
  resolveSearchTrackPlayabilityFromIndex,
  searchPlayabilityLabel,
} from './searchPlayability.ts'

const track = {
  id: 'yandex-music:42',
  sourceId: 'yandex-music',
  externalId: '42',
}

function availability(
  status: (typeof PLAYBACK_AVAILABILITY_STATUS)[keyof typeof PLAYBACK_AVAILABILITY_STATUS],
): CanonicalPlaybackAvailability {
  const copy = {
    sourceTrackKey: 'yandex-music:42',
    sourceId: 'yandex-music',
    canonicalTrackId: 'canonical-1',
    status,
  }
  return {
    canonicalTrackId: 'canonical-1',
    copies: [copy],
    playableCopies:
      status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE ? [copy] : [],
    hasPlayableCopy: status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  }
}

test('without PlaybackAvailability entry indicator stays unknown', () => {
  resetPlaybackAvailabilitySourceIndexForTests()
  assert.equal(resolveSearchTrackPlayability(track, {}), 'unknown')
  assert.equal(searchPlayabilityLabel('unknown'), null)
})

test('PLAYABLE from PlaybackAvailability shows Доступно', () => {
  resetPlaybackAvailabilitySourceIndexForTests()
  const byCanonicalId = {
    'canonical-1': availability(PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
  }
  assert.equal(resolveSearchTrackPlayability(track, byCanonicalId), 'playable')
  assert.equal(searchPlayabilityLabel('playable'), 'Доступно')
  assert.equal(
    findPlaybackAvailabilityForSearchTrack(track, byCanonicalId)?.status,
    PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
})

test('sourceTrackKey index is reused until byCanonicalId reference changes', () => {
  resetPlaybackAvailabilitySourceIndexForTests()
  const byCanonicalId = {
    'canonical-1': availability(PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
  }
  const first = getPlaybackAvailabilitySourceIndex(byCanonicalId)
  const second = getPlaybackAvailabilitySourceIndex(byCanonicalId)
  assert.equal(first, second)
  assert.equal(first.get('yandex-music:42')?.status, 'PLAYABLE')

  const rebuilt = {
    'canonical-1': availability(PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE),
  }
  const third = getPlaybackAvailabilitySourceIndex(rebuilt)
  assert.notEqual(third, first)
  assert.equal(
    resolveSearchTrackPlayabilityFromIndex(track, third),
    'unavailable',
  )
})

test('confirmed non-playable PlaybackAvailability statuses show Недоступно', () => {
  for (const status of [
    PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
    PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
    PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED,
    PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
    PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
  ] as const) {
    assert.equal(
      resolveSearchTrackPlayabilityFromAvailability({ status }),
      'unavailable',
      status,
    )
  }
  assert.equal(searchPlayabilityLabel('unavailable'), 'Недоступно')
})

test('UNKNOWN PlaybackAvailability hides indicator', () => {
  resetPlaybackAvailabilitySourceIndexForTests()
  assert.equal(
    resolveSearchTrackPlayabilityFromAvailability({
      status: PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
    }),
    'unknown',
  )
  assert.equal(
    resolveSearchTrackPlayability(track, {
      'canonical-1': availability(PLAYBACK_AVAILABILITY_STATUS.UNKNOWN),
    }),
    'unknown',
  )
})

test('reconcileProviderWarningsBySource clears recovered source only', () => {
  const next = reconcileProviderWarningsBySource(
    {
      flaky: 'flaky: timeout',
      broken: 'broken: 500',
    },
    {
      recoveredSourceIds: ['flaky'],
      errors: [{ sourceId: 'broken', message: 'broken: still down' }],
    },
  )
  assert.deepEqual(next, {
    broken: 'broken: still down',
  })
  assert.deepEqual(providerWarningsList(next), ['broken: still down'])
})

test('reconcile keeps other warnings when one source recovers without new errors', () => {
  const next = reconcileProviderWarningsBySource(
    {
      a: 'a: fail',
      b: 'b: fail',
    },
    {
      recoveredSourceIds: ['a'],
      errors: [],
    },
  )
  assert.deepEqual(next, { b: 'b: fail' })
})
