import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockMusicSourceAdapter } from '../../sources/adapters/mock/mockAdapter.ts'
import { createVKMusicAdapter } from '../../sources/adapters/vk-music/index.ts'
import { assessLocalFileAvailability } from './localProbe.ts'
import { resetLibrarySession } from '../libraryPersistence/session.ts'
import { invalidatePlaybackAvailabilityBySource } from './cache.ts'
import { resetPlaybackAvailability } from './resetPlaybackAvailability.ts'
import {
  resolveCanonicalPlaybackAvailability,
  type AvailabilityAdapter,
  type AvailabilityPort,
} from './resolveCanonicalPlaybackAvailability.ts'
import { usePlaybackAvailabilityStore } from '../../store/playbackAvailabilityStore.ts'
import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
} from '../../types/playbackAvailability.ts'

const CANONICAL_ID = 'can_availability'

function copyOf(sourceId: string, externalId: string): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: CANONICAL_ID,
    sourceId,
    externalId,
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: 1_000,
    artworkUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function portFor(
  adapters: Record<string, AvailabilityAdapter>,
  enabled: (sourceId: string) => boolean = () => true,
): AvailabilityPort {
  return {
    findAdapter(sourceId) {
      return adapters[sourceId] ?? null
    },
    isSourceEnabled: enabled,
  }
}

function streamingAdapter(
  id: string,
  patch: Partial<AvailabilityAdapter> = {},
): AvailabilityAdapter {
  return {
    id,
    capabilities: ['preview'],
    supportsStreaming: true,
    isAvailable: () => true,
    ...patch,
  }
}

test('PLAYABLE copy stays playable and is not unknown', async () => {
  resetPlaybackAvailability()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('mock', 'a1')] },
    {
      now: 1_000,
      port: portFor({
        mock: streamingAdapter('mock', {
          checkTrackAvailability: async () => ({
            status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
          }),
        }),
      }),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  assert.equal(result.hasPlayableCopy, true)
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)
})

test('disabled source is NOT_CONNECTED before a provider check', async () => {
  resetPlaybackAvailability()
  let checks = 0
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('spotify', 's1')] },
    {
      now: 1_000,
      port: portFor(
        {
          spotify: streamingAdapter('spotify', {
            capabilities: ['auth', 'preview'],
            isAvailable: () => false,
            checkTrackAvailability: async () => {
              checks += 1
              return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
            },
          }),
        },
        () => false,
      ),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED)
  assert.equal(result.copies[0]?.reason, PLAYBACK_AVAILABILITY_REASON.SOURCE_DISABLED)
  assert.equal(checks, 0)
})

test('auth-capable disconnected adapter is AUTH_REQUIRED and is not playable', async () => {
  resetPlaybackAvailability()
  let candidates = 0
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('yandex-music', 'y1')] },
    {
      now: 1_000,
      port: portFor({
        'yandex-music': streamingAdapter('yandex-music', {
          capabilities: ['auth', 'preview'],
          isAvailable: () => false,
          getPlaybackCandidates: async () => {
            candidates += 1
            return []
          },
        }),
      }),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED)
  assert.equal(candidates, 0)
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('no-rights response is SUBSCRIPTION_REQUIRED and not playable', async () => {
  resetPlaybackAvailability()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('yandex-music', 'y1')] },
    {
      now: 1_000,
      port: portFor({
        'yandex-music': streamingAdapter('yandex-music', {
          capabilities: ['auth', 'preview'],
          checkTrackAvailability: async () => {
            throw { status: 403, code: 'NO_RIGHTS', message: 'no rights' }
          },
        }),
      }),
    },
  )
  assert.equal(
    result.copies[0]?.status,
    PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
  )
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('adapter without playback support is UNSUPPORTED', async () => {
  resetPlaybackAvailability()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('custom-website', 'c1')] },
    {
      now: 1_000,
      port: portFor({
        'custom-website': {
          id: 'custom-website',
          capabilities: ['browse'],
          supportsStreaming: false,
          isAvailable: () => false,
        },
      }),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED)
})

test('network failure is UNKNOWN and not UNAVAILABLE', async () => {
  resetPlaybackAvailability()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('spotify', 's1')] },
    {
      now: 1_000,
      port: portFor({
        spotify: streamingAdapter('spotify', {
          checkTrackAvailability: async () => {
            const error = new Error('network timeout')
            error.name = 'TimeoutError'
            throw error
          },
        }),
      }),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)
  assert.equal(result.copies[0]?.reason, PLAYBACK_AVAILABILITY_REASON.NETWORK)
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)
})

test('multiple copies aggregate without choosing a source', async () => {
  resetPlaybackAvailability()
  const copies = [
    copyOf('yandex-music', 'y1'),
    copyOf('spotify', 's1'),
    copyOf('local-folder', 'file.mp3'),
  ]
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies },
    {
      now: 1_000,
      port: portFor(
        {
          'yandex-music': streamingAdapter('yandex-music', {
            capabilities: ['auth', 'preview'],
            checkTrackAvailability: async () => ({
              status: PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
              reason: PLAYBACK_AVAILABILITY_REASON.SUBSCRIPTION_REQUIRED,
            }),
          }),
          spotify: streamingAdapter('spotify', {
            capabilities: ['auth', 'preview'],
            isAvailable: () => true,
          }),
          'local-folder': streamingAdapter('local-folder', {
            kind: 'local-folder',
            type: 'filesystem',
            checkTrackAvailability: async () => ({
              status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
            }),
          }),
        },
        (sourceId) => sourceId !== 'spotify',
      ),
    },
  )
  assert.equal(
    result.copies.find((item) => item.sourceId === 'yandex-music')?.status,
    PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
  )
  assert.equal(
    result.copies.find((item) => item.sourceId === 'spotify')?.status,
    PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
  )
  assert.equal(
    result.copies.find((item) => item.sourceId === 'local-folder')?.status,
    PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
  assert.equal(result.hasPlayableCopy, true)
  assert.equal(result.playableCopies.length, 1)
  assert.equal(result.playableCopies[0]?.sourceId, 'local-folder')
})

test('no playable copy leaves the canonical input unchanged', async () => {
  resetPlaybackAvailability()
  const copies = [copyOf('yandex-music', 'y1'), copyOf('spotify', 's1')]
  const before = JSON.stringify(copies)
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies },
    {
      now: 1_000,
      port: portFor(
        {
          'yandex-music': streamingAdapter('yandex-music', {
            capabilities: ['auth', 'preview'],
            checkTrackAvailability: async () => ({
              status: PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
              reason: PLAYBACK_AVAILABILITY_REASON.SUBSCRIPTION_REQUIRED,
            }),
          }),
          spotify: streamingAdapter('spotify'),
        },
        (sourceId) => sourceId !== 'spotify',
      ),
    },
  )
  assert.equal(result.hasPlayableCopy, false)
  assert.equal(result.playableCopies.length, 0)
  assert.equal(JSON.stringify(copies), before)
})

test('resolver does not start playback', async () => {
  resetPlaybackAvailability()
  let started = 0
  const adapter = streamingAdapter('mock', {
    checkTrackAvailability: async () => ({
      status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
    }),
  })
  const guarded = new Proxy(adapter, {
    get(target, prop, receiver) {
      if (prop === 'getStream' || prop === 'play' || prop === 'start') {
        started += 1
        throw new Error('playback started')
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('mock', 'a1')] },
    { now: 1_000, port: portFor({ mock: guarded }) },
  )
  assert.equal(result.hasPlayableCopy, true)
  assert.equal(started, 0)
})

test('cache returns the same result inside its lifetime', async () => {
  resetPlaybackAvailability()
  let checks = 0
  const port = portFor({
    mock: streamingAdapter('mock', {
      checkTrackAvailability: async () => {
        checks += 1
        return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
      },
    }),
  })
  const input = { canonicalTrackId: CANONICAL_ID, copies: [copyOf('mock', 'a1')] }
  const first = await resolveCanonicalPlaybackAvailability(input, { now: 5_000, port })
  const second = await resolveCanonicalPlaybackAvailability(input, { now: 5_100, port })
  assert.equal(first.copies[0]?.status, second.copies[0]?.status)
  assert.equal(first.copies[0]?.checkedAt, second.copies[0]?.checkedAt)
  assert.equal(checks, 1)
})

test('source disconnect invalidates the availability cache', async () => {
  resetPlaybackAvailability()
  let checks = 0
  const port = portFor({
    spotify: streamingAdapter('spotify', {
      checkTrackAvailability: async () => {
        checks += 1
        return { status: PLAYBACK_AVAILABILITY_STATUS.UNKNOWN, reason: PLAYBACK_AVAILABILITY_REASON.NOT_CHECKED }
      },
    }),
  })
  const input = { canonicalTrackId: CANONICAL_ID, copies: [copyOf('spotify', 's1')] }
  await resolveCanonicalPlaybackAvailability(input, { now: 5_000, port })
  invalidatePlaybackAvailabilityBySource('spotify')
  await resolveCanonicalPlaybackAvailability(input, { now: 5_100, port })
  assert.equal(checks, 2)
})

test('logout clears availability state and cache', async () => {
  resetPlaybackAvailability()
  let checks = 0
  const port = portFor({
    mock: streamingAdapter('mock', {
      checkTrackAvailability: async () => {
        checks += 1
        return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
      },
    }),
  })
  const input = { canonicalTrackId: CANONICAL_ID, copies: [copyOf('mock', 'a1')] }
  await resolveCanonicalPlaybackAvailability(input, { now: 5_000, port })
  assert.ok(usePlaybackAvailabilityStore.getState().byCanonicalId[CANONICAL_ID])
  resetLibrarySession()
  assert.equal(
    usePlaybackAvailabilityStore.getState().byCanonicalId[CANONICAL_ID],
    undefined,
  )
  await resolveCanonicalPlaybackAvailability(input, { now: 5_100, port })
  assert.equal(checks, 2)
})

test('local file without a handle is not PLAYABLE', () => {
  const unsupported = assessLocalFileAvailability({
    accessState: 'unsupported',
    hasDirectoryHandle: false,
    hasFileHandle: false,
  })
  const missingHandle = assessLocalFileAvailability({
    accessState: 'granted',
    hasDirectoryHandle: true,
    hasFileHandle: false,
  })
  assert.notEqual(unsupported.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  assert.equal(missingHandle.status, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE)
  assert.equal(
    missingHandle.reason,
    PLAYBACK_AVAILABILITY_REASON.LOCAL_HANDLE_MISSING,
  )
  assert.equal(
    assessLocalFileAvailability({
      accessState: 'granted',
      hasDirectoryHandle: true,
      hasFileHandle: true,
    }).status,
    PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
})

test('mock demo track with a preview is PLAYABLE', async () => {
  resetPlaybackAvailability()
  const adapter = createMockMusicSourceAdapter()
  const page = await adapter.fetchTracks()
  const track = page.tracks[0]
  assert.ok(track)
  const probe = await adapter.checkTrackAvailability?.(track)
  assert.equal(probe?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})

test('stub provider is not marked playable', async () => {
  resetPlaybackAvailability()
  const vk = createVKMusicAdapter()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('vk-music', 'v1')] },
    {
      now: 1_000,
      port: portFor({ 'vk-music': vk }, () => true),
    },
  )
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED)
  assert.equal(result.hasPlayableCopy, false)
})

test('connected adapter without a track probe stays UNKNOWN', async () => {
  resetPlaybackAvailability()
  const result = await resolveCanonicalPlaybackAvailability(
    { canonicalTrackId: CANONICAL_ID, copies: [copyOf('spotify', 's1')] },
    {
      now: 1_000,
      port: portFor({
        spotify: streamingAdapter('spotify', {
          capabilities: ['auth', 'preview'],
          isAvailable: () => true,
          getPlaybackCandidates: async () => [],
        }),
      }),
    },
  )
  assert.equal(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN)
  assert.equal(result.copies[0]?.reason, PLAYBACK_AVAILABILITY_REASON.NOT_CHECKED)
  assert.notEqual(result.copies[0]?.status, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
})
