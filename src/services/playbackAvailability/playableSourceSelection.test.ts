import assert from 'node:assert/strict'
import test from 'node:test'
import { getCollectionEngine } from '../collectionEngine/index.ts'
import { createMockMusicSourceAdapter } from '../../sources/adapters/mock/mockAdapter.ts'
import { resetPlaybackAvailability } from './resetPlaybackAvailability.ts'
import { prepareCanonicalPlayback } from './prepareCanonicalPlayback.ts'
import { selectPlayableSourceCopy } from './selectPlayableSourceCopy.ts'
import {
  type AvailabilityAdapter,
  type AvailabilityPort,
} from './resolveCanonicalPlaybackAvailability.ts'
import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityStatus,
  type SourceCopyAvailability,
} from '../../types/playbackAvailability.ts'
import {
  PLAYABLE_SOURCE_SELECTION_REASON,
  isPlaybackHandoffReady,
} from '../../types/playableSourceSelection.ts'
import type { Track } from '../../types/track.ts'

const CANONICAL_ID = 'can_selection'

function copyOf(
  sourceId: string,
  externalId: string,
  title = 'Song',
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: CANONICAL_ID,
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

function statusOf(
  copy: SourceCopy,
  status: PlaybackAvailabilityStatus,
): SourceCopyAvailability {
  return {
    sourceTrackKey: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    canonicalTrackId: copy.canonicalTrackId,
    status,
  }
}

function availabilityOf(
  copies: readonly SourceCopyAvailability[],
): CanonicalPlaybackAvailability {
  const playableCopies = copies.filter(
    (copy) => copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
  return {
    canonicalTrackId: CANONICAL_ID,
    copies: [...copies],
    playableCopies,
    hasPlayableCopy: playableCopies.length > 0,
  }
}

function trackFor(copy: SourceCopy, previewUrl: string | null = null): Track {
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

function probeAdapter(
  id: string,
  status: PlaybackAvailabilityStatus,
  calls: { probe: number; stream: number; play: number; connect: number },
): AvailabilityAdapter {
  return {
    id,
    capabilities: ['preview'],
    supportsStreaming: true,
    isAvailable: () => true,
    async checkTrackAvailability() {
      calls.probe += 1
      return { status }
    },
    async getPlaybackCandidates() {
      calls.stream += 1
      return []
    },
    async getStream() {
      calls.stream += 1
      return null
    },
    play() {
      calls.play += 1
    },
    connect() {
      calls.connect += 1
    },
  } as AvailabilityAdapter
}

test('one PLAYABLE copy is selected and the disconnected copy is not', () => {
  const yandex = copyOf('yandex-music', 'y1')
  const local = copyOf('local-folder', 'song.mp3', 'Local Song')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [yandex, local],
    availability: availabilityOf([
      statusOf(yandex, PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED),
      statusOf(local, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
  })
  assert.equal(result.selectedCopy?.sourceTrackKey, local.sourceTrackKey)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.SELECTED)
  assert.equal(result.selectedTrack, null)
})

test('preferred PLAYABLE copy is kept when another copy is also PLAYABLE', () => {
  const spotify = copyOf('spotify', '202')
  const local = copyOf('local-folder', 'song.mp3')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [local, spotify],
    preferredSourceTrackKey: spotify.sourceTrackKey,
    availability: availabilityOf([
      statusOf(spotify, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(local, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
  })
  assert.equal(result.selectedCopy?.sourceTrackKey, 'spotify:202')
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.PREFERRED_SOURCE)
})

test('several PLAYABLE copies without a preference use sourceTrackKey order', () => {
  const later = copyOf('spotify', 'z')
  const earlier = copyOf('local-folder', 'a')
  const input = {
    canonicalTrackId: CANONICAL_ID,
    copies: [later, earlier],
    availability: availabilityOf([
      statusOf(later, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      statusOf(earlier, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
  }
  const first = selectPlayableSourceCopy(input)
  const second = selectPlayableSourceCopy({
    ...input,
    copies: [earlier, later],
  })
  assert.equal(first.selectedCopy?.sourceTrackKey, 'local-folder:a')
  assert.equal(second.selectedCopy?.sourceTrackKey, 'local-folder:a')
  assert.equal(first.reason, PLAYABLE_SOURCE_SELECTION_REASON.DETERMINISTIC_TIE_BREAK)
  assert.equal(second.reason, first.reason)
})

test('a preferred copy that is not PLAYABLE is replaced before playback', () => {
  const yandex = copyOf('yandex-music', 'y1')
  const local = copyOf('local-folder', 'song.mp3')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [yandex, local],
    preferredSourceTrackKey: yandex.sourceTrackKey,
    availability: availabilityOf([
      statusOf(yandex, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED),
      statusOf(local, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
    ]),
  })
  assert.equal(result.selectedCopy?.sourceTrackKey, local.sourceTrackKey)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.PRE_PLAY_ALTERNATIVE)
})

test('no PLAYABLE copy returns NO_PLAYABLE_COPY without throwing', () => {
  const yandex = copyOf('yandex-music', 'y1')
  const spotify = copyOf('spotify', 's1')
  const local = copyOf('local-folder', 'song.mp3')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [yandex, spotify, local],
    availability: availabilityOf([
      statusOf(yandex, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED),
      statusOf(spotify, PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED),
      statusOf(local, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE),
    ]),
  })
  assert.equal(result.selectedCopy, null)
  assert.equal(result.selectedTrack, null)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY)
  assert.equal(isPlaybackHandoffReady(result), false)
})

test('UNKNOWN is never selected', () => {
  const only = copyOf('spotify', 's1')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [only],
    availability: availabilityOf([
      statusOf(only, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN),
    ]),
  })
  assert.equal(result.selectedCopy, null)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY)
})

test('unsupported stub copies are not selected and no provider method runs', () => {
  let calls = 0
  const vk = copyOf('vk-music', 'v1')
  const zaycev = copyOf('zaycev', 'z1')
  const result = selectPlayableSourceCopy({
    canonicalTrackId: CANONICAL_ID,
    copies: [vk, zaycev],
    availability: availabilityOf([
      statusOf(vk, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED),
      statusOf(zaycev, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED),
    ]),
  })
  assert.equal(calls, 0)
  assert.equal(result.selectedCopy, null)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY)
})

test('PLAYABLE copy without a track snapshot is not handed to playback', async () => {
  resetPlaybackAvailability()
  const local = copyOf('local-folder', 'song.mp3')
  const calls = { probe: 0, stream: 0, play: 0, connect: 0 }
  const result = await prepareCanonicalPlayback(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [local],
    },
    {
      now: 10_000,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
          calls,
        ),
      }),
      findTrack: () => null,
    },
  )
  assert.equal(result.selectedCopy?.sourceTrackKey, local.sourceTrackKey)
  assert.equal(result.selectedTrack, null)
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING)
  assert.equal(isPlaybackHandoffReady(result), false)
  assert.equal(calls.stream, 0)
  assert.equal(calls.play, 0)
})

test('a snapshot from another source is not reused', async () => {
  resetPlaybackAvailability()
  const local = copyOf('local-folder', 'song.mp3')
  const other = trackFor(copyOf('spotify', 's1'), 'https://example.test/other.mp3')
  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: CANONICAL_ID, copies: [local] },
    {
      now: 11_000,
      port: portFor({
        'local-folder': probeAdapter('local-folder', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE, {
          probe: 0,
          stream: 0,
          play: 0,
          connect: 0,
        }),
      }),
      findTrack: () => other,
    },
  )
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.TRACK_SNAPSHOT_MISSING)
  assert.equal(result.selectedTrack, null)
})

test('a playback error does not start the other PLAYABLE copy', async () => {
  resetPlaybackAvailability()
  const first = copyOf('local-folder', 'a')
  const second = copyOf('spotify', 'b')
  const started: string[] = []
  const result = await prepareCanonicalPlayback(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [second, first],
      preferredSourceTrackKey: first.sourceTrackKey,
    },
    {
      now: 12_000,
      port: portFor({
        'local-folder': probeAdapter('local-folder', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE, {
          probe: 0,
          stream: 0,
          play: 0,
          connect: 0,
        }),
        spotify: probeAdapter('spotify', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE, {
          probe: 0,
          stream: 0,
          play: 0,
          connect: 0,
        }),
      }),
      findTrack: (key) => trackFor(key === first.sourceTrackKey ? first : second, 'https://example.test/a.mp3'),
    },
  )
  assert.equal(isPlaybackHandoffReady(result), true)
  assert.equal(result.selectedTrack?.id, first.sourceTrackKey)
  await assert.rejects(async () => {
    started.push(result.selectedTrack!.id)
    throw new Error('playback failed')
  })
  assert.deepEqual(started, [first.sourceTrackKey])
  assert.equal(started.includes(second.sourceTrackKey), false)
})

test('prepare does not stream, play, or connect a provider', async () => {
  resetPlaybackAvailability()
  const local = copyOf('local-folder', 'song.mp3')
  const calls = { probe: 0, stream: 0, play: 0, connect: 0 }
  const before = JSON.stringify(local)
  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: CANONICAL_ID, copies: [local] },
    {
      now: 13_000,
      port: portFor({
        'local-folder': probeAdapter(
          'local-folder',
          PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
          calls,
        ),
      }),
      findTrack: () => trackFor(local, null),
    },
  )
  assert.equal(result.selectedTrack?.id, local.sourceTrackKey)
  assert.equal(calls.probe, 1)
  assert.equal(calls.stream, 0)
  assert.equal(calls.play, 0)
  assert.equal(calls.connect, 0)
  assert.equal(JSON.stringify(local), before)
  assert.equal('previewUrl' in local, false)
})

test('mock playback uses the stored source track and its preview', async () => {
  resetPlaybackAvailability()
  const adapter = createMockMusicSourceAdapter()
  const page = await adapter.fetchTracks()
  const track = page.tracks[0]
  assert.ok(track?.previewUrl)
  const copy = copyOf('mock', track.externalId, track.title)
  const result = await prepareCanonicalPlayback(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copy],
      preferredSourceTrackKey: track.id,
    },
    {
      now: 14_000,
      port: portFor({ mock: adapter }),
      findTrack: (key) => (key === track.id || key === copy.sourceTrackKey ? track : null),
    },
  )
  assert.equal(result.reason, PLAYABLE_SOURCE_SELECTION_REASON.PREFERRED_SOURCE)
  assert.equal(result.selectedTrack?.id, track.id)
  assert.equal(result.selectedTrack?.previewUrl, track.previewUrl)
  assert.notEqual(result.selectedTrack, track)
})

test('collection snapshot is the playback track and canonical copy stays without a url', async () => {
  resetPlaybackAvailability()
  const engine = getCollectionEngine()
  const copy = copyOf('mock', 'stored')
  const stored = trackFor(copy, 'https://example.test/stored.mp3')
  engine.addTrack(stored)
  try {
    const result = await prepareCanonicalPlayback(
      { canonicalTrackId: CANONICAL_ID, copies: [copy] },
      {
        now: 15_000,
        port: portFor({
          mock: probeAdapter('mock', PLAYBACK_AVAILABILITY_STATUS.PLAYABLE, {
            probe: 0,
            stream: 0,
            play: 0,
            connect: 0,
          }),
        }),
      },
    )
    assert.equal(result.selectedTrack?.previewUrl, stored.previewUrl)
    assert.equal(result.selectedTrack?.id, stored.id)
    assert.equal('previewUrl' in copy, false)
    const kept = engine.getTrack(stored.id)
    assert.equal(kept?.track.previewUrl, stored.previewUrl)
  } finally {
    engine.removeTrack(stored.id)
  }
})

test('a second prepare inside the availability ttl does not probe again', async () => {
  resetPlaybackAvailability()
  const local = copyOf('local-folder', 'song.mp3')
  const calls = { probe: 0, stream: 0, play: 0, connect: 0 }
  const options = {
    now: 16_000,
    ttlMs: 30_000,
    port: portFor({
      'local-folder': probeAdapter(
        'local-folder',
        PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
        calls,
      ),
    }),
    findTrack: () => trackFor(local, null),
  }
  await prepareCanonicalPlayback(
    { canonicalTrackId: CANONICAL_ID, copies: [local] },
    options,
  )
  await prepareCanonicalPlayback(
    { canonicalTrackId: CANONICAL_ID, copies: [local] },
    options,
  )
  assert.equal(calls.probe, 1)
  assert.equal(calls.stream, 0)
})

test('disabled yandex stays unselected while local PLAYABLE is prepared', async () => {
  resetPlaybackAvailability()
  const yandex = copyOf('yandex-music', 'y1')
  const local = copyOf('local-folder', 'song.mp3')
  const streamCalls = { yandex: 0, local: 0 }
  const result = await prepareCanonicalPlayback(
    { canonicalTrackId: CANONICAL_ID, copies: [yandex, local] },
    {
      now: 17_000,
      port: portFor(
        {
          'yandex-music': {
            id: 'yandex-music',
            capabilities: ['auth', 'preview'],
            supportsStreaming: true,
            isAvailable: () => false,
            async getPlaybackCandidates() {
              streamCalls.yandex += 1
              return []
            },
          },
          'local-folder': {
            id: 'local-folder',
            type: 'filesystem',
            kind: 'local-folder',
            capabilities: ['preview'],
            supportsStreaming: true,
            isAvailable: () => true,
            async checkTrackAvailability() {
              return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
            },
            async getStream() {
              streamCalls.local += 1
              return 'file://song'
            },
          },
        },
        (sourceId) => sourceId === 'local-folder',
      ),
      findTrack: (key) => (key === local.sourceTrackKey ? trackFor(local, null) : null),
    },
  )
  assert.equal(result.selectedCopy?.sourceId, 'local-folder')
  assert.equal(
    result.availability.copies.find((copy) => copy.sourceId === 'yandex-music')?.status,
    PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
  )
  assert.equal(streamCalls.yandex, 0)
  assert.equal(streamCalls.local, 0)
  assert.equal(isPlaybackHandoffReady(result), true)
})
