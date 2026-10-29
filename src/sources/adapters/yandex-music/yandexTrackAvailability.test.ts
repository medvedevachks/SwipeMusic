import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
} from '../../../types/playbackAvailability.ts'
import { YandexApiError } from './api.ts'
import {
  assessYandexTrackRow,
  probeYandexTrackAvailability,
} from './trackAvailability.ts'
import type { YandexTrack } from './types.ts'
import { resetPlaybackAvailability } from '../../../services/playbackAvailability/resetPlaybackAvailability.ts'
import { prepareCanonicalPlayback } from '../../../services/playbackAvailability/prepareCanonicalPlayback.ts'
import type { AvailabilityAdapter } from '../../../services/playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import type { SourceCopy } from '../../../types/canonical.ts'
import { isPlaybackHandoffReady } from '../../../types/playableSourceSelection.ts'

test('assess: available track is PLAYABLE without stream URL', () => {
  const probe = assessYandexTrackRow(
    { id: '1', title: 'A', available: true },
    { hasPlus: false },
  )
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('assess: missing row is UNAVAILABLE', () => {
  const probe = assessYandexTrackRow(null, { hasPlus: true })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)
  assert.equal(probe.reason, PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING)
})

test('assess: premium-only without Plus is SUBSCRIPTION_REQUIRED', () => {
  const probe = assessYandexTrackRow(
    {
      id: '2',
      available: false,
      availableForPremiumUsers: true,
    },
    { hasPlus: false },
  )
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED)
})

test('assess: ambiguous metadata stays UNKNOWN not PLAYABLE', () => {
  const probe = assessYandexTrackRow({ id: '3', title: 'Maybe' }, { hasPlus: false })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)
  assert.notEqual(probe.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('probeYandexTrackAvailability: connected + available metadata → PLAYABLE, no stream', async () => {
  const calls = { tracks: 0, stream: 0 }
  const probe = await probeYandexTrackAvailability({
    isAvailable: true,
    hasPlus: true,
    externalId: '42',
    getTracksByIds: async (ids) => {
      calls.tracks += 1
      assert.equal(ids, '42')
      const row: YandexTrack = { id: '42', title: 'Live', available: true }
      return [row]
    },
  })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  assert.equal(calls.tracks, 1)
  assert.equal(calls.stream, 0)
})

test('probeYandexTrackAvailability: disconnected → AUTH_REQUIRED', async () => {
  const probe = await probeYandexTrackAvailability({
    isAvailable: false,
    hasPlus: false,
    externalId: '1',
    getTracksByIds: async () => {
      throw new Error('must not fetch')
    },
  })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED)
})

test('probeYandexTrackAvailability: deleted track', async () => {
  const probe = await probeYandexTrackAvailability({
    isAvailable: true,
    hasPlus: true,
    externalId: 'gone',
    getTracksByIds: async () => [],
  })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)
  assert.equal(probe.reason, PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING)
})

test('probeYandexTrackAvailability: network stays UNKNOWN', async () => {
  const probe = await probeYandexTrackAvailability({
    isAvailable: true,
    hasPlus: false,
    externalId: 'n',
    getTracksByIds: async () => {
      throw new YandexApiError('failed to fetch', 0, 'NETWORK')
    },
  })
  assert.equal(probe.status, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)
  assert.equal(probe.reason, PLAYBACK_AVAILABILITY_REASON.NETWORK)
  assert.notEqual(probe.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('YandexMusicAdapter wires checkTrackAvailability to metadata probe without stream', () => {
  const source = readFileSync(new URL('./YandexMusicAdapter.ts', import.meta.url), 'utf8')
  assert.match(source, /async checkTrackAvailability\(/)
  assert.match(source, /probeYandexTrackAvailability/)
  assert.match(source, /getTracksByIds/)
  const method = source.slice(source.indexOf('async checkTrackAvailability'))
  const end = method.indexOf('\n  getPlaylists')
  const body = end >= 0 ? method.slice(0, end) : method.slice(0, 800)
  assert.equal(body.includes('resolveDirectStreamUrl'), false)
  assert.equal(body.includes('getDownloadInfo'), false)
  assert.equal(body.includes('getPlaybackCandidates'), false)
})

test('prepareCanonicalPlayback with Yandex probe contract yields PLAYABLE handoff', async () => {
  resetPlaybackAvailability()
  const copy: SourceCopy = {
    sourceTrackKey: 'yandex-music:99',
    canonicalTrackId: 'can_y99',
    sourceId: 'yandex-music',
    externalId: '99',
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: 120_000,
    artworkUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  let streamCalls = 0
  const yandexAdapter: AvailabilityAdapter = {
    id: 'yandex-music',
    capabilities: ['browse', 'search', 'library', 'preview', 'auth'],
    supportsStreaming: true,
    isAvailable: () => true,
    checkTrackAvailability: async (track) =>
      probeYandexTrackAvailability({
        isAvailable: true,
        hasPlus: true,
        externalId: track.externalId,
        getTracksByIds: async () => [{ id: track.externalId, available: true }],
      }),
    getPlaybackCandidates: async () => {
      streamCalls += 1
      return []
    },
  }

  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: 'can_y99', copies: [copy] },
    {
      now: 40_000,
      port: {
        isSourceEnabled: () => true,
        findAdapter: () => yandexAdapter,
      },
      findTrack: () => ({
        id: copy.sourceTrackKey,
        sourceId: 'yandex-music',
        externalId: '99',
        title: 'Song',
        artist: 'Artist',
      }),
    },
  )

  assert.equal(isPlaybackHandoffReady(result), true)
  assert.equal(result.selectedTrack?.id, copy.sourceTrackKey)
  assert.equal(streamCalls, 0)
})

test('UNKNOWN from Yandex probe is not PLAYABLE for prepareCanonicalPlayback', async () => {
  resetPlaybackAvailability()
  const copy: SourceCopy = {
    sourceTrackKey: 'yandex-music:u',
    canonicalTrackId: 'can_u',
    sourceId: 'yandex-music',
    externalId: 'u',
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: null,
    artworkUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const yandexAdapter: AvailabilityAdapter = {
    id: 'yandex-music',
    capabilities: ['auth'],
    supportsStreaming: true,
    isAvailable: () => true,
    checkTrackAvailability: async (track) =>
      probeYandexTrackAvailability({
        isAvailable: true,
        hasPlus: false,
        externalId: track.externalId,
        getTracksByIds: async () => [{ id: track.externalId, title: 'No flag' }],
      }),
  }

  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: 'can_u', copies: [copy] },
    {
      now: 41_000,
      port: {
        isSourceEnabled: () => true,
        findAdapter: () => yandexAdapter,
      },
      findTrack: () => ({
        id: copy.sourceTrackKey,
        sourceId: 'yandex-music',
        externalId: 'u',
        title: 'Song',
        artist: 'Artist',
      }),
    },
  )

  assert.equal(isPlaybackHandoffReady(result), false)
  assert.equal(result.selectedCopy, null)
})
