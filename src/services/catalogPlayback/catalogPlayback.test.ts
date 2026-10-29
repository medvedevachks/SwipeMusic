import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalLibraryItem, SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type PlaybackAvailabilityStatus,
} from '../../types/playbackAvailability.ts'
import {
  PLAYABLE_SOURCE_SELECTION_REASON,
  isPlaybackHandoffReady,
} from '../../types/playableSourceSelection.ts'
import type { Track } from '../../types/track.ts'
import type {
  AvailabilityAdapter,
  AvailabilityPort,
} from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import { resetPlaybackAvailability } from '../playbackAvailability/resetPlaybackAvailability.ts'
import { prepareCanonicalPlayback } from '../playbackAvailability/prepareCanonicalPlayback.ts'
import {
  buildCatalogPlaybackQueue,
  resolveCatalogItemPlayback,
} from './buildCatalogPlaybackQueue.ts'
import {
  cancelCatalogPlaybackGate,
  playUserCatalog,
  resetCatalogPlaybackGate,
} from './playUserCatalog.ts'
import { CATALOG_PLAYBACK_MESSAGE } from './messages.ts'

const CATALOG = { id: 'cat_party', name: 'Вечеринка' }

function copyOf(
  canonicalTrackId: string,
  sourceId: string,
  externalId: string,
  title = 'Song',
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId,
    sourceId,
    externalId,
    title,
    artist: 'Artist',
    album: null,
    durationMs: 180_000,
    artworkUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function itemOf(
  canonicalTrackId: string,
  copies: SourceCopy[],
  title = 'Song',
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id: canonicalTrackId,
      title,
      artist: 'Artist',
      album: null,
      durationMs: 180_000,
      artworkUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    copies,
    state: {
      addedAt: '2026-01-01T00:00:00.000Z',
      lastPlayed: null,
      playCount: 0,
      liked: false,
      likedAt: null,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
    catalogIds: [CATALOG.id],
  }
}

function trackFor(copy: SourceCopy, previewUrl: string | null = 'https://example.test/a.mp3'): Track {
  return {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
    album: copy.album ?? undefined,
    durationMs: copy.durationMs ?? undefined,
    previewUrl,
  }
}

function probeAdapter(
  id: string,
  status: PlaybackAvailabilityStatus,
): AvailabilityAdapter {
  return {
    id,
    capabilities: ['stream'],
    supportsStreaming: true,
    isAvailable: () => true,
    async checkTrackAvailability() {
      return { status }
    },
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

function findTrackMap(tracks: Track[]): (key: string) => Track | null {
  const map = new Map(tracks.map((track) => [track.id, track]))
  return (key) => map.get(key) ?? null
}

test('single catalog track play starts playlist queue at that position', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_a', 'yandex-music', '111', 'One')
  const b = copyOf('can_b', 'yandex-music', '222', 'Two')
  const items = [itemOf('can_a', [a], 'One'), itemOf('can_b', [b], 'Two')]
  const calls: Array<{ tracks: string[]; startIndex: number; context: unknown }> = []

  const result = await playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_b',
    },
    {
      now: 20_000,
      port: portFor({
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a), trackFor(b)]),
      playSelection: async (options) => {
        calls.push({
          tracks: options.tracks.map((track) => track.id),
          startIndex: options.startIndex,
          context: options.context,
        })
      },
    },
  )

  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.deepEqual(result.tracks.map((track) => track.id), [
    a.sourceTrackKey,
    b.sourceTrackKey,
  ])
  assert.equal(result.startIndex, 1)
  assert.deepEqual(calls[0]?.context, {
    type: 'playlist',
    id: CATALOG.id,
    title: CATALOG.name,
  })
  assert.equal(calls[0]?.startIndex, 1)
})

test('listen catalog starts the first available track and skips unavailable rows', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const demo = copyOf('can_demo', 'mock', 'd1', 'Demo')
  const yandex = copyOf('can_ok', 'yandex-music', '333', 'Live')
  const items = [
    itemOf('can_demo', [demo], 'Demo'),
    itemOf('can_ok', [yandex], 'Live'),
  ]
  const calls: number[] = []

  const result = await playUserCatalog(
    { catalog: CATALOG, items },
    {
      now: 21_000,
      port: portFor({
        mock: probeAdapter('mock', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(demo), trackFor(yandex)]),
      playSelection: async (options) => {
        calls.push(options.startIndex)
      },
    },
  )

  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.deepEqual(
    result.tracks.map((track) => track.id),
    [yandex.sourceTrackKey],
  )
  assert.equal(result.startIndex, 0)
  assert.deepEqual(calls, [0])
})

test('next/previous stay inside catalog playlist context and order', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_1', 'local-folder', 'a.mp3', 'A')
  const b = copyOf('can_2', 'local-folder', 'b.mp3', 'B')
  const c = copyOf('can_3', 'local-folder', 'c.mp3', 'C')
  let captured: { tracks: Track[]; startIndex: number; context: unknown } | null =
    null

  const result = await playUserCatalog(
    {
      catalog: CATALOG,
      items: [
        itemOf('can_1', [a], 'A'),
        itemOf('can_2', [b], 'B'),
        itemOf('can_3', [c], 'C'),
      ],
      startCanonicalTrackId: 'can_2',
    },
    {
      now: 22_000,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a), trackFor(b), trackFor(c)]),
      playSelection: async (options) => {
        captured = options
      },
    },
  )

  assert.equal(result.status, 'played')
  assert.ok(captured)
  assert.equal(captured!.context.type, 'playlist')
  assert.equal(captured!.startIndex, 1)
  assert.deepEqual(
    captured!.tracks.map((track) => track.id),
    [a.sourceTrackKey, b.sourceTrackKey, c.sourceTrackKey],
  )
  // Next from startIndex 1 → index 2; Previous → index 0 — within catalog only.
  assert.equal(captured!.tracks[captured!.startIndex + 1]?.id, c.sourceTrackKey)
  assert.equal(captured!.tracks[captured!.startIndex - 1]?.id, a.sourceTrackKey)
})

test('yandex SourceCopy is selected when PLAYABLE and snapshot exists', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('can_y', 'yandex-music', '999', 'Yandex Song')
  const resolved = await resolveCatalogItemPlayback(itemOf('can_y', [yandex], 'Yandex Song'), {
    now: 23_000,
    port: portFor({
      'yandex-music': probeAdapter(
        'yandex-music',
        PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
      ),
    }),
    findTrack: findTrackMap([trackFor(yandex)]),
  })
  assert.equal(resolved.status, 'ready')
  if (resolved.status !== 'ready') return
  assert.equal(resolved.entry.track.sourceId, 'yandex-music')
  assert.equal(resolved.entry.track.id, yandex.sourceTrackKey)
  assert.equal(isPlaybackHandoffReady(resolved.entry.selection), true)
})

test('demo-only SourceCopy is unavailable for catalog playback without allowDemo', async () => {
  resetPlaybackAvailability()
  const demo = copyOf('can_d', 'mock', 'm1', 'Demo only')
  const resolved = await resolveCatalogItemPlayback(itemOf('can_d', [demo], 'Demo only'), {
    now: 24_000,
    port: portFor({
      mock: probeAdapter('mock', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    }),
    findTrack: findTrackMap([trackFor(demo)]),
    allowDemo: false,
  })
  assert.equal(resolved.status, 'unavailable')
  if (resolved.status !== 'unavailable') return
  assert.equal(resolved.message, CATALOG_PLAYBACK_MESSAGE.TRACK_UNAVAILABLE)
})

test('several copies of one composition pick one PLAYABLE handoff track', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('can_multi', 'yandex-music', 'y1', 'Multi')
  const local = copyOf('can_multi', 'local-folder', 'f1.mp3', 'Multi')
  const demo = copyOf('can_multi', 'mock', 'm2', 'Multi')
  const built = await buildCatalogPlaybackQueue({
    items: [itemOf('can_multi', [demo, yandex, local], 'Multi')],
    now: 25_000,
    port: portFor({
      mock: probeAdapter('mock', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      'yandex-music': probeAdapter(
        'yandex-music',
        PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
      ),
      'local-folder': probeAdapter(
        'local-folder',
        PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
      ),
    }),
    findTrack: findTrackMap([trackFor(yandex), trackFor(local), trackFor(demo)]),
  })
  assert.equal(built.queue.length, 1)
  assert.ok(
    built.queue[0]!.track.id === local.sourceTrackKey ||
      built.queue[0]!.track.id === yandex.sourceTrackKey,
  )
  assert.notEqual(built.queue[0]!.track.sourceId, 'mock')
})

test('disabled source leaves the composition unavailable and keeps catalog membership', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const yandex = copyOf('can_off', 'yandex-music', 'off1', 'Off')
  const item = itemOf('can_off', [yandex], 'Off')
  const membershipBefore = [...item.catalogIds]

  const result = await playUserCatalog(
    { catalog: CATALOG, items: [item], startCanonicalTrackId: 'can_off' },
    {
      now: 26_000,
      port: portFor(
        {
          'yandex-music': probeAdapter(
            'yandex-music',
            PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
          ),
        },
        () => false,
      ),
      findTrack: findTrackMap([trackFor(yandex)]),
      playSelection: async () => {
        assert.fail('must not start playback')
      },
    },
  )

  assert.equal(result.status, 'unavailable')
  assert.deepEqual(item.catalogIds, membershipBefore)
})

test('missing source Track snapshot can hydrate via adapter resolveMissingTrack', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('can_miss', 'yandex-music', 'miss1', 'Missing snap')
  const hydrated = trackFor(yandex)

  const viaPrepare = await prepareCanonicalPlayback(
    { canonicalTrackId: 'can_miss', copies: [yandex] },
    {
      now: 27_000,
      port: portFor({
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: () => null,
      resolveMissingTrack: async () => hydrated,
    },
  )
  assert.equal(isPlaybackHandoffReady(viaPrepare), true)
  assert.equal(viaPrepare.selectedTrack?.id, yandex.sourceTrackKey)
  assert.notEqual(
    viaPrepare.reason,
    PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING,
  )

  const viaCatalog = await resolveCatalogItemPlayback(
    itemOf('can_miss', [yandex], 'Missing snap'),
    {
      now: 27_100,
      port: portFor({
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: () => null,
      resolveMissingTrack: async () => hydrated,
    },
  )
  assert.equal(viaCatalog.status, 'ready')
})

test('missing snapshot without adapter hydrate stays unavailable', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('can_miss2', 'yandex-music', 'miss2', 'No hydrate')
  const resolved = await resolveCatalogItemPlayback(
    itemOf('can_miss2', [yandex], 'No hydrate'),
    {
      now: 28_000,
      port: portFor({
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: () => null,
      resolveMissingTrack: async () => null,
    },
  )
  assert.equal(resolved.status, 'unavailable')
  if (resolved.status !== 'unavailable') return
  assert.equal(resolved.message, CATALOG_PLAYBACK_MESSAGE.SNAPSHOT_MISSING)
  assert.equal(
    resolved.selection.reason,
    PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING,
  )
})

test('empty catalog does not call playback', async () => {
  resetCatalogPlaybackGate()
  let called = false
  const result = await playUserCatalog(
    { catalog: CATALOG, items: [] },
    {
      playSelection: async () => {
        called = true
      },
    },
  )
  assert.equal(result.status, 'empty')
  assert.equal(result.message, CATALOG_PLAYBACK_MESSAGE.EMPTY_CATALOG)
  assert.equal(called, false)
})

test('playback failure does not invent another track and returns error', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_err', 'local-folder', 'e.mp3', 'Err')
  const result = await playUserCatalog(
    { catalog: CATALOG, items: [itemOf('can_err', [a], 'Err')] },
    {
      now: 29_000,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a)]),
      playSelection: async () => {
        throw new Error('player failed')
      },
    },
  )
  assert.equal(result.status, 'error')
  assert.equal(result.message, CATALOG_PLAYBACK_MESSAGE.FAILED)
})

test('NotAllowedError after queue setup counts as played, not FAILED', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_ios', 'local-folder', 'ios.mp3', 'iOS')
  const result = await playUserCatalog(
    { catalog: CATALOG, items: [itemOf('can_ios', [a], 'iOS')] },
    {
      now: 30_500,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a)]),
      playSelection: async () => {
        const error = new Error('play() failed because the user did not interact')
        error.name = 'NotAllowedError'
        throw error
      },
    },
  )
  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.equal(result.tracks[0]?.id, a.sourceTrackKey)
})

test('cancel during prepare returns busy and does not call playSelection', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_nav', 'local-folder', 'nav.mp3', 'Nav')
  let playCalls = 0
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  const pending = playUserCatalog(
    { catalog: CATALOG, items: [itemOf('can_nav', [a], 'Nav')] },
    {
      now: 30_600,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability() {
            await hold
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap([trackFor(a)]),
      playSelection: async () => {
        playCalls += 1
      },
    },
  )

  cancelCatalogPlaybackGate()
  release()
  const result = await pending
  assert.equal(result.status, 'busy')
  assert.equal(playCalls, 0)
})

test('adapter hydrate rejects a track with mismatched identity', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('can_wrong', 'yandex-music', 'w1', 'Wanted')
  const wrong = trackFor(copyOf('can_wrong', 'yandex-music', 'other', 'Other'))
  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: 'can_wrong', copies: [yandex] },
    {
      now: 30_700,
      port: portFor({
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: () => null,
      resolveMissingTrack: async () => wrong,
    },
  )
  assert.equal(result.selectedTrack, null)
  assert.equal(
    result.reason,
    PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING,
  )
})

test('rapid repeated play rejects the second start while the first is in flight', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const a = copyOf('can_race', 'local-folder', 'r.mp3', 'Race')
  const item = itemOf('can_race', [a], 'Race')
  let resolveFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    resolveFirst = resolve
  })
  const started: string[] = []

  const first = playUserCatalog(
    { catalog: CATALOG, items: [item] },
    {
      now: 30_000,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a)]),
      playSelection: async () => {
        started.push('first')
        await firstGate
      },
    },
  )

  // Let the first call enter playSelection before the second tap.
  await Promise.resolve()
  await Promise.resolve()

  const secondResult = await playUserCatalog(
    { catalog: CATALOG, items: [item] },
    {
      now: 30_100,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(a)]),
      playSelection: async () => {
        started.push('second')
      },
    },
  )

  assert.equal(secondResult.status, 'busy')
  assert.equal(secondResult.message, CATALOG_PLAYBACK_MESSAGE.BUSY)
  resolveFirst()
  const firstResult = await first
  assert.equal(firstResult.status, 'played')
  assert.deepEqual(started, ['first'])
})
