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
import {
  applyCatalogLoopRepeat,
  applyCatalogLoopRepeatIfOwned,
  resetCatalogRepeatPolicyForTests,
} from './catalogRepeatPolicy.ts'
import {
  getPlaybackQueue,
  PlaybackQueue,
} from '../playbackQueue/PlaybackQueue.ts'

function installMemoryLocalStorage(): void {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
}

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
      replaceQueue: async (options) => {
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
  // Ранний старт выбранного трека, затем полная playlist-очередь.
  assert.deepEqual(calls[0], {
    tracks: [b.sourceTrackKey],
    startIndex: 0,
    context: {
      type: 'playlist',
      id: CATALOG.id,
      title: CATALOG.name,
    },
  })
  assert.equal(calls[1]?.startIndex, 1)
  assert.deepEqual(calls[1]?.tracks, [a.sourceTrackKey, b.sourceTrackKey])
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
      playSelection: async () => {
        // early single-track start
      },
      replaceQueue: async (options) => {
        captured = options
      },
    },
  )

  assert.equal(result.status, 'played')
  assert.ok(captured)
  assert.equal((captured!.context as { type: string }).type, 'playlist')
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
      replaceQueue: async () => {
        assert.fail('must not expand queue')
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

test('NotAllowedError after queue setup counts as played with gesture hint', async () => {
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
  assert.equal(result.needsUserPlayGesture, true)
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

test('UNKNOWN availability is not queued as PLAYABLE', async () => {
  resetPlaybackAvailability()
  const copy = copyOf('can_u', 'yandex-music', 'u1', 'Unknown')
  const resolved = await resolveCatalogItemPlayback(itemOf('can_u', [copy], 'Unknown'), {
    now: 31_000,
    port: portFor({
      'yandex-music': probeAdapter(
        'yandex-music',
        PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
      ),
    }),
    findTrack: findTrackMap([trackFor(copy)]),
  })
  assert.equal(resolved.status, 'unavailable')
})

test('100+ items keep catalog order and never exceed prepare concurrency', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const items = Array.from({ length: 120 }, (_, index) => {
    const copy = copyOf(`can_${index}`, 'local-folder', `f${index}.mp3`, `T${index}`)
    return itemOf(`can_${index}`, [copy], `T${index}`)
  })
  const tracks = items.map((item) => trackFor(item.copies[0]!))
  let inFlight = 0
  let maxInFlight = 0

  const built = await buildCatalogPlaybackQueue({
    items,
    now: 32_000,
    concurrency: 4,
    port: portFor({
      'local-folder': {
        id: 'local-folder',
        capabilities: ['stream'],
        supportsStreaming: true,
        isAvailable: () => true,
        async checkTrackAvailability() {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 5))
          inFlight -= 1
          return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
        },
      },
    }),
    findTrack: findTrackMap(tracks),
    onInFlight: (count) => {
      maxInFlight = Math.max(maxInFlight, count)
    },
  })

  assert.equal(built.queue.length, 120)
  assert.deepEqual(
    built.queue.map((entry) => entry.canonicalTrackId),
    items.map((item) => item.canonicalTrack.id),
  )
  assert.ok(maxInFlight <= 4, `maxInFlight=${maxInFlight}`)
  assert.ok(maxInFlight >= 2)
})

test('selected track starts before the rest of a large catalog finishes', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const items = Array.from({ length: 40 }, (_, index) => {
    const copy = copyOf(`can_p_${index}`, 'local-folder', `p${index}.mp3`, `P${index}`)
    return itemOf(`can_p_${index}`, [copy], `P${index}`)
  })
  const tracks = items.map((item) => trackFor(item.copies[0]!))
  const events: string[] = []
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_p_7',
    },
    {
      now: 33_000,
      concurrency: 4,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'p7.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        events.push(`play:${options.tracks.map((track) => track.externalId).join(',')}`)
        earlyStarted()
      },
      replaceQueue: async (options) => {
        events.push(`expand:${options.tracks.length}:${options.startIndex}`)
      },
    },
  )

  await earlyGate
  assert.deepEqual(events, ['play:p7.mp3'])
  releaseRest()
  const result = await pending
  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.equal(result.startIndex, 7)
  assert.equal(result.tracks.length, 40)
  assert.ok(events.includes('expand:40:7'))
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

test('background expand preserves currentIndex and history after Next', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_n0', 'local-folder', 'n0.mp3', 'N0'),
    copyOf('can_n1', 'local-folder', 'n1.mp3', 'N1'),
    copyOf('can_n2', 'local-folder', 'n2.mp3', 'N2'),
    copyOf('can_n3', 'local-folder', 'n3.mp3', 'N3'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `N${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const queue = new PlaybackQueue()
  const context = {
    type: 'playlist' as const,
    id: CATALOG.id,
    title: CATALOG.name,
  }
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_n0',
    },
    {
      now: 34_000,
      concurrency: 4,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'n0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async (options) =>
        queue.replacePlaylistItemsPreservingPlayback(options.tracks, {
          type: 'playlist',
          id: options.context.id,
        }),
    },
  )

  await earlyGate
  // Пока готовится хвост — пользователь уже Next внутри того же каталога.
  queue.append([tracks[1]!, tracks[2]!])
  assert.equal(queue.next()?.id, tracks[1]!.id)
  const before = queue.getSnapshot()
  assert.equal(before.currentIndex, 1)
  assert.deepEqual(before.history, [tracks[0]!.id, tracks[1]!.id])
  assert.equal(before.context.type, 'playlist')

  releaseRest()
  const result = await pending
  assert.equal(result.status, 'played')
  const after = queue.getSnapshot()
  assert.equal(after.context.type, 'playlist')
  assert.equal(
    after.context.type === 'playlist' ? after.context.id : null,
    context.id,
  )
  assert.equal(after.items.length, 4)
  assert.equal(after.currentIndex, 1)
  assert.equal(after.items[after.currentIndex]?.id, tracks[1]!.id)
  assert.deepEqual(after.history, [tracks[0]!.id, tracks[1]!.id])
  assert.equal(after.historyIndex, 1)
  assert.equal(after.repeatMode, before.repeatMode)
  assert.equal(after.shuffleMode, before.shuffleMode)
})

test('background expand preserves position after Previous', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_v0', 'local-folder', 'v0.mp3', 'V0'),
    copyOf('can_v1', 'local-folder', 'v1.mp3', 'V1'),
    copyOf('can_v2', 'local-folder', 'v2.mp3', 'V2'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `V${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const queue = new PlaybackQueue()
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_v0',
    },
    {
      now: 35_000,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'v0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async (options) =>
        queue.replacePlaylistItemsPreservingPlayback(options.tracks, {
          type: 'playlist',
          id: options.context.id,
        }),
    },
  )

  await earlyGate
  queue.append([tracks[1]!, tracks[2]!])
  queue.next()
  queue.next()
  assert.equal(queue.previous()?.id, tracks[1]!.id)
  const historyBefore = queue.getSnapshot().history

  releaseRest()
  const result = await pending
  assert.equal(result.status, 'played')
  const after = queue.getSnapshot()
  assert.equal(after.currentIndex, 1)
  assert.equal(after.items[1]?.id, tracks[1]!.id)
  assert.deepEqual(after.history, historyBefore)
})

test('late catalog prepare does not force Repeat ALL after leaving to search', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  resetCatalogRepeatPolicyForTests()
  const copies = [
    copyOf('can_r0', 'local-folder', 'r0.mp3', 'R0'),
    copyOf('can_r1', 'local-folder', 'r1.mp3', 'R1'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `R${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const queue = getPlaybackQueue()
  queue.clear()
  queue.setRepeatMode('OFF')
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_r0',
    },
    {
      now: 36_500,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'r0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        applyCatalogLoopRepeat(options.context.id)
        earlyStarted()
      },
      replaceQueue: async (options) =>
        queue.replacePlaylistItemsPreservingPlayback(options.tracks, {
          type: 'playlist',
          id: options.context.id,
        }),
    },
  )

  await earlyGate
  assert.equal(queue.getRepeatMode(), 'ALL')
  const searchHit = trackFor(copyOf('can_hit2', 'yandex-music', 'hit2', 'Hit2'))
  queue.setQueue([searchHit], 0, {
    type: 'search-seed',
    query: 'hit2',
    seedTrackId: searchHit.id,
  })
  assert.equal(queue.getRepeatMode(), 'OFF')

  releaseRest()
  await pending
  assert.equal(applyCatalogLoopRepeatIfOwned(CATALOG.id), false)
  assert.equal(queue.getRepeatMode(), 'OFF')
  assert.equal(queue.getSnapshot().context.type, 'search-seed')
})

test('late catalog expand does not overwrite search-seed queue', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_s0', 'local-folder', 's0.mp3', 'S0'),
    copyOf('can_s1', 'local-folder', 's1.mp3', 'S1'),
    copyOf('can_s2', 'local-folder', 's2.mp3', 'S2'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `S${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const searchHit = trackFor(copyOf('can_hit', 'yandex-music', 'hit1', 'Hit'))
  const queue = new PlaybackQueue()
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })
  let expandApplied = true

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_s0',
    },
    {
      now: 36_000,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 's0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async (options) => {
        expandApplied = queue.replacePlaylistItemsPreservingPlayback(
          options.tracks,
          { type: 'playlist', id: options.context.id },
        )
        return expandApplied
      },
    },
  )

  await earlyGate
  queue.setQueue([searchHit], 0, {
    type: 'search-seed',
    query: 'hit',
    seedTrackId: searchHit.id,
  })

  releaseRest()
  const result = await pending
  assert.equal(result.status, 'played')
  assert.equal(expandApplied, false)
  const snap = queue.getSnapshot()
  assert.equal(snap.context.type, 'search-seed')
  assert.deepEqual(
    snap.items.map((track) => track.id),
    [searchHit.id],
  )
})

test('late catalog expand does not overwrite my-wave radio queue', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_w0', 'local-folder', 'w0.mp3', 'W0'),
    copyOf('can_w1', 'local-folder', 'w1.mp3', 'W1'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `W${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const wave = trackFor(copyOf('can_wave', 'yandex-music', 'wave1', 'Wave'))
  const queue = new PlaybackQueue()
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })
  let expandApplied = true

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_w0',
    },
    {
      now: 37_000,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'w0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async (options) => {
        expandApplied = queue.replacePlaylistItemsPreservingPlayback(
          options.tracks,
          { type: 'playlist', id: options.context.id },
        )
        return expandApplied
      },
    },
  )

  await earlyGate
  queue.setQueue([wave], 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })

  releaseRest()
  await pending
  assert.equal(expandApplied, false)
  assert.equal(queue.getSnapshot().context.type, 'radio')
  assert.equal(queue.current()?.id, wave.id)
})

test('late expand for another catalog id is ignored', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_o0', 'local-folder', 'o0.mp3', 'O0'),
    copyOf('can_o1', 'local-folder', 'o1.mp3', 'O1'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `O${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const other = trackFor(copyOf('can_other', 'local-folder', 'other.mp3', 'Other'))
  const queue = new PlaybackQueue()
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })
  let expandApplied = true

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_o0',
    },
    {
      now: 38_000,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'o0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async (options) => {
        expandApplied = queue.replacePlaylistItemsPreservingPlayback(
          options.tracks,
          { type: 'playlist', id: options.context.id },
        )
        return expandApplied
      },
    },
  )

  await earlyGate
  queue.setQueue([other], 0, {
    type: 'playlist',
    id: 'cat_other',
    title: 'Другой',
  })

  releaseRest()
  await pending
  assert.equal(expandApplied, false)
  const snap = queue.getSnapshot()
  assert.equal(snap.context.type, 'playlist')
  assert.equal(snap.context.type === 'playlist' ? snap.context.id : null, 'cat_other')
  assert.equal(snap.items[0]?.id, other.id)
})

test('cancel after early start skips expand and keeps playing track', async () => {
  installMemoryLocalStorage()
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const copies = [
    copyOf('can_c0', 'local-folder', 'c0.mp3', 'C0'),
    copyOf('can_c1', 'local-folder', 'c1.mp3', 'C1'),
  ]
  const items = copies.map((copy, index) =>
    itemOf(copy.canonicalTrackId, [copy], `C${index}`),
  )
  const tracks = copies.map((copy) => trackFor(copy))
  const queue = new PlaybackQueue()
  let releaseRest!: () => void
  const holdRest = new Promise<void>((resolve) => {
    releaseRest = resolve
  })
  let earlyStarted!: () => void
  const earlyGate = new Promise<void>((resolve) => {
    earlyStarted = resolve
  })
  let expandCalls = 0

  const pending = playUserCatalog(
    {
      catalog: CATALOG,
      items,
      startCanonicalTrackId: 'can_c0',
    },
    {
      now: 39_000,
      concurrency: 2,
      port: portFor({
        'local-folder': {
          id: 'local-folder',
          capabilities: ['stream'],
          supportsStreaming: true,
          isAvailable: () => true,
          async checkTrackAvailability(track) {
            if (track.externalId !== 'c0.mp3') {
              await holdRest
            }
            return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
          },
        },
      }),
      findTrack: findTrackMap(tracks),
      playSelection: async (options) => {
        queue.setQueue(options.tracks, options.startIndex, options.context)
        earlyStarted()
      },
      replaceQueue: async () => {
        expandCalls += 1
      },
    },
  )

  await earlyGate
  assert.equal(queue.current()?.id, tracks[0]!.id)
  cancelCatalogPlaybackGate()
  releaseRest()
  const result = await pending
  assert.equal(result.status, 'played')
  assert.equal(expandCalls, 0)
  assert.equal(queue.current()?.id, tracks[0]!.id)
  assert.equal(queue.getSnapshot().items.length, 1)
})

test('demo-only and unavailable rows stay out of the playback queue', async () => {
  resetPlaybackAvailability()
  resetCatalogPlaybackGate()
  const demo = copyOf('can_demo2', 'mock', 'demo2', 'DemoOnly')
  const bad = copyOf('can_bad', 'yandex-music', 'bad', 'Bad')
  const ok = copyOf('can_ok2', 'local-folder', 'ok2.mp3', 'Ok')
  const items = [
    itemOf('can_demo2', [demo], 'DemoOnly'),
    itemOf('can_bad', [bad], 'Bad'),
    itemOf('can_ok2', [ok], 'Ok'),
  ]
  const result = await playUserCatalog(
    { catalog: CATALOG, items },
    {
      now: 40_000,
      allowDemo: false,
      port: portFor({
        mock: probeAdapter('mock', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        'yandex-music': probeAdapter(
          'yandex-music',
          PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
        ),
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        ),
      }),
      findTrack: findTrackMap([trackFor(demo), trackFor(bad), trackFor(ok)]),
      playSelection: async () => undefined,
    },
  )
  assert.equal(result.status, 'played')
  if (result.status !== 'played') return
  assert.deepEqual(
    result.tracks.map((track) => track.id),
    [ok.sourceTrackKey],
  )
})

test('replacePlaylistItemsPreservingPlayback rejects foreign owner without setQueue reset', () => {
  installMemoryLocalStorage()
  const queue = new PlaybackQueue()
  const a = trackFor(copyOf('can_a', 'local-folder', 'a.mp3', 'A'))
  const b = trackFor(copyOf('can_b', 'local-folder', 'b.mp3', 'B'))
  const c = trackFor(copyOf('can_c', 'local-folder', 'c.mp3', 'C'))
  queue.setQueue([a], 0, {
    type: 'playlist',
    id: CATALOG.id,
    title: CATALOG.name,
  })
  queue.setRepeatMode('ALL')
  queue.setShuffleMode('OFF')
  queue.append([b])
  queue.next()
  const before = queue.getSnapshot()

  const rejected = queue.replacePlaylistItemsPreservingPlayback([a, b, c], {
    type: 'playlist',
    id: 'cat_foreign',
  })
  assert.equal(rejected, false)
  assert.deepEqual(queue.getSnapshot(), before)

  const accepted = queue.replacePlaylistItemsPreservingPlayback([a, b, c], {
    type: 'playlist',
    id: CATALOG.id,
  })
  assert.equal(accepted, true)
  const after = queue.getSnapshot()
  assert.equal(after.items.length, 3)
  assert.equal(after.currentIndex, 1)
  assert.equal(after.items[1]?.id, b.id)
  assert.deepEqual(after.history, before.history)
  assert.equal(after.repeatMode, 'ALL')
})
