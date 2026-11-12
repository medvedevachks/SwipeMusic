import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../types/playbackAvailability.ts'
import type { CanonicalPlaybackAvailability } from '../../types/playbackAvailability.ts'
import {
  findPlaybackAvailabilityForSearchTrack,
  mergeProviderWarnings,
  resolveSearchTrackPlayability,
  resolveSearchTrackPlayabilityFromAvailability,
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
  assert.equal(resolveSearchTrackPlayability(track, {}), 'unknown')
  assert.equal(searchPlayabilityLabel('unknown'), null)
})

test('PLAYABLE from PlaybackAvailability shows Доступно', () => {
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

test('missing availability stays unknown even if caller invents tags elsewhere', () => {
  assert.equal(resolveSearchTrackPlayability(track, {}), 'unknown')
  assert.equal(
    resolveSearchTrackPlayabilityFromAvailability(null),
    'unknown',
  )
})

test('mergeProviderWarnings dedupes and keeps order', () => {
  assert.deepEqual(
    mergeProviderWarnings(['A: fail', 'B: fail'], ['A: fail', 'C: fail']),
    ['A: fail', 'B: fail', 'C: fail'],
  )
})
