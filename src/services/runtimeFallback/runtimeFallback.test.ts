import assert from 'node:assert/strict'
import test from 'node:test'
import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityStatus,
  type SourceCopyAvailability,
} from '../../types/playbackAvailability.ts'
import {
  RUNTIME_FALLBACK_POLICY,
  RUNTIME_FALLBACK_STATUS,
  SOURCE_DISCOVERY_STATUS,
  type PlaybackAttemptOutcome,
  type PlaybackAttemptPort,
  type PlaybackAttemptRequest,
  type RegisteredSourceDescriptor,
} from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import {
  createProductionDiscoveryRegistry,
  sourceCopiesFromDiscovery,
  type AlternateSourceDiscoveryProvider,
} from './discoveryPort.ts'
import { RuntimePlaybackFallbackOrchestrator } from './RuntimePlaybackFallbackOrchestrator.ts'
import { buildCanonicalSourceInventory } from './sourceInventory.ts'

const CANONICAL_ID = 'can_fallback'
const OTHER_CANONICAL_ID = 'can_other'

function copyOf(
  sourceId: string,
  externalId: string,
  canonicalTrackId = CANONICAL_ID,
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId,
    sourceId,
    externalId,
    title: 'Song',
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
  canonicalTrackId = CANONICAL_ID,
): CanonicalPlaybackAvailability {
  const playableCopies = copies.filter(
    (copy) =>
      copy.canonicalTrackId === canonicalTrackId &&
      copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
  return {
    canonicalTrackId,
    copies: [...copies],
    playableCopies,
    hasPlayableCopy: playableCopies.length > 0,
  }
}

function trackFor(copy: SourceCopy): Track {
  return {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
    album: copy.album ?? undefined,
    durationMs: copy.durationMs ?? undefined,
  }
}

type AttemptLog = {
  calls: PlaybackAttemptRequest[]
  stops: number
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function successOutcome(
  request: PlaybackAttemptRequest,
  mode: 'seek' | 'unsupported' | 'none' = 'seek',
): PlaybackAttemptOutcome {
  const position = request.resumePositionSeconds
  if (position == null || position <= 0 || mode === 'none') {
    return {
      ok: true,
      resumeAttempted: false,
      resumeSucceeded: false,
      resumeUnsupported: false,
    }
  }
  if (mode === 'unsupported') {
    return {
      ok: true,
      resumeAttempted: false,
      resumeSucceeded: false,
      resumeUnsupported: true,
    }
  }
  return {
    ok: true,
    resumeAttempted: true,
    resumeSucceeded: true,
    resumeUnsupported: false,
  }
}

function scriptedPort(
  script: Array<
    | { ok: false; positionSeconds: number | null }
    | { ok: true; resume?: 'seek' | 'unsupported' | 'none' }
    | { pending: true }
  >,
  log: AttemptLog,
  pending?: { promise: Promise<PlaybackAttemptOutcome>; resolve: (value: PlaybackAttemptOutcome) => void },
): PlaybackAttemptPort {
  let index = 0
  return {
    stopPrevious() {
      log.stops += 1
    },
    async attempt(request) {
      log.calls.push(request)
      const step = script[index] ?? { ok: false, positionSeconds: null }
      index += 1
      if ('pending' in step) {
        return pending!.promise
      }
      if (step.ok) {
        return successOutcome(request, step.resume ?? 'seek')
      }
      return {
        ok: false,
        positionSeconds: step.positionSeconds,
        resumeAttempted: false,
        resumeSucceeded: false,
        resumeUnsupported: false,
      }
    },
  }
}

function keysOf(calls: readonly PlaybackAttemptRequest[]): string[] {
  return calls.map((call) => call.sourceTrackKey)
}

test('AUTO switches from a failed playable copy to the next and emits one source change', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const events: string[] = []
  orchestrator.subscribe((event) => {
    events.push(`${event.fromSourceTrackKey}->${event.toSourceTrackKey}:${event.reason}`)
  })
  const result = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyB, copyA],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      policy: RUNTIME_FALLBACK_POLICY.AUTO,
      findTrack: (key) => {
        const copy = key === copyA.sourceTrackKey ? copyA : copyB
        return trackFor(copy)
      },
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 10 },
        { ok: true },
      ],
      log,
    ),
  )
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey, copyB.sourceTrackKey])
  assert.equal(log.stops, 1)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.deepEqual(events, [
    `${copyA.sourceTrackKey}->${copyB.sourceTrackKey}:RUNTIME_FALLBACK`,
  ])
  assert.equal(result.events.length, 1)
})

test('three playable copies are each attempted once until one succeeds', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const copyC = copyOf('gamma', 'c')
  const log: AttemptLog = { calls: [], stops: 0 }
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const result = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyC, copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyC, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor([copyA, copyB, copyC].find((copy) => copy.sourceTrackKey === key)!),
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 1 },
        { ok: false, positionSeconds: 2 },
        { ok: true },
      ],
      log,
    ),
  )
  assert.deepEqual(keysOf(log.calls), [
    copyA.sourceTrackKey,
    copyB.sourceTrackKey,
    copyC.sourceTrackKey,
  ])
  assert.equal(new Set(keysOf(log.calls)).size, 3)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.equal(result.currentCopy?.sourceTrackKey, copyC.sourceTrackKey)
})

test('all playable copies fail once and the session stops', async () => {
  const copies = [copyOf('alpha', 'a'), copyOf('beta', 'b'), copyOf('gamma', 'c')]
  const log: AttemptLog = { calls: [], stops: 0 }
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const result = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies,
      availability: availabilityOf(
        copies.map((copy) => statusOf(copy, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)),
      ),
      preferredSourceTrackKey: copies[0]!.sourceTrackKey,
      findTrack: (key) => trackFor(copies.find((copy) => copy.sourceTrackKey === key)!),
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 1 },
        { ok: false, positionSeconds: 2 },
        { ok: false, positionSeconds: 3 },
      ],
      log,
    ),
  )
  assert.deepEqual(
    keysOf(log.calls),
    copies.map((copy) => copy.sourceTrackKey),
  )
  assert.equal(log.calls.length, 3)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED)
  assert.deepEqual(
    result.failedCopies.map((entry) => entry.copy.sourceTrackKey),
    copies.map((copy) => copy.sourceTrackKey),
  )
})

test('known non-playable copies are grouped and a registered provider without a copy is not', async () => {
  const subscription = copyOf('alpha', 'sub')
  const disconnected = copyOf('beta', 'off')
  const auth = copyOf('gamma', 'auth')
  const unavailable = copyOf('delta', 'miss')
  const unknown = copyOf('epsilon', 'unk')
  const unsupported = copyOf('zeta', 'stub')
  const copies = [subscription, disconnected, auth, unavailable, unknown, unsupported]
  const registered: RegisteredSourceDescriptor = {
    sourceId: 'spotify',
    enabled: true,
    capabilities: ['auth', 'search'],
  }
  const inventory = buildCanonicalSourceInventory({
    canonicalTrackId: CANONICAL_ID,
    knownCopies: copies,
    registeredSources: [registered],
  })
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies,
      availability: availabilityOf([
        statusOf(subscription, PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED),
        statusOf(disconnected, PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED),
        statusOf(auth, PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED),
        statusOf(unavailable, PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE),
        statusOf(unknown, PLAYBACK_AVAILABILITY_STATUS.UNKNOWN),
        statusOf(unsupported, PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED),
      ]),
      findTrack: () => null,
      registeredSources: inventory.registeredSources,
    },
    scriptedPort([], log),
  )
  assert.equal(log.calls.length, 0)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.NO_PLAYABLE_COPY)
  assert.deepEqual(
    result.alternatives.subscriptionRequiredCopies.map((copy) => copy.sourceTrackKey),
    [subscription.sourceTrackKey],
  )
  assert.deepEqual(
    result.alternatives.notConnectedCopies.map((copy) => copy.sourceTrackKey),
    [disconnected.sourceTrackKey],
  )
  assert.deepEqual(
    result.alternatives.authRequiredCopies.map((copy) => copy.sourceTrackKey),
    [auth.sourceTrackKey],
  )
  assert.deepEqual(
    result.alternatives.unavailableCopies.map((copy) => copy.sourceTrackKey),
    [unavailable.sourceTrackKey],
  )
  assert.deepEqual(
    result.alternatives.unknownCopies.map((copy) => copy.sourceTrackKey),
    [unknown.sourceTrackKey],
  )
  assert.deepEqual(
    result.alternatives.unsupportedCopies.map((copy) => copy.sourceTrackKey),
    [unsupported.sourceTrackKey],
  )
  assert.deepEqual(
    result.registeredSourcesWithoutCopy.map((source) => source.sourceId),
    ['spotify'],
  )
  const mentioned = JSON.stringify(result.alternatives)
  assert.equal(mentioned.includes('spotify'), false)
})

test('ASK does not start the next playable copy', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      policy: RUNTIME_FALLBACK_POLICY.ASK,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort([{ ok: false, positionSeconds: 4 }], log),
  )
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED)
  assert.equal(result.nextPlayableCopy?.sourceTrackKey, copyB.sourceTrackKey)
  assert.equal(result.events.length, 0)
})

test('OFF does not start the next playable copy', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      policy: RUNTIME_FALLBACK_POLICY.OFF,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort([{ ok: false, positionSeconds: 4 }], log),
  )
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.STOPPED_BY_POLICY)
  assert.equal(result.events.length, 0)
})

test('non-playable statuses are never passed to attemptPlayback', async () => {
  const copies = [
    copyOf('alpha', 'sub'),
    copyOf('beta', 'unk'),
    copyOf('gamma', 'off'),
    copyOf('delta', 'stub'),
  ]
  const statuses = [
    PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
    PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
    PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
    PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
  ]
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies,
      availability: availabilityOf(copies.map((copy, index) => statusOf(copy, statuses[index]!))),
      findTrack: (key) => trackFor(copies.find((copy) => copy.sourceTrackKey === key)!),
    },
    scriptedPort([], log),
  )
  assert.equal(log.calls.length, 0)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.NO_PLAYABLE_COPY)
})

test('a new manual play ignores a late success and does not start the old fallback copy', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const other = copyOf('alpha', 'other-track', OTHER_CANONICAL_ID)
  const log: AttemptLog = { calls: [], stops: 0 }
  const pending = deferred<PlaybackAttemptOutcome>()
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const running = orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort([{ pending: true }, { ok: true }], log, pending),
  )
  await Promise.resolve()
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  const replacement = orchestrator.run(
    {
      canonicalTrackId: OTHER_CANONICAL_ID,
      copies: [other],
      availability: availabilityOf(
        [statusOf(other, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)],
        OTHER_CANONICAL_ID,
      ),
      preferredSourceTrackKey: other.sourceTrackKey,
      findTrack: (key) => (key === other.sourceTrackKey ? trackFor(other) : null),
    },
    scriptedPort([{ ok: true }], log),
  )
  pending.resolve(successOutcome(log.calls[0]!))
  const [first, second] = await Promise.all([running, replacement])
  assert.equal(first.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.equal(second.status, RUNTIME_FALLBACK_STATUS.PLAYING)
  assert.equal(second.currentCopy?.sourceTrackKey, other.sourceTrackKey)
  assert.equal(keysOf(log.calls).includes(copyB.sourceTrackKey), false)
})

test('a runtime error after playback has started continues with the next playable copy', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const port = scriptedPort(
    [
      { ok: true, resume: 'none' },
      { ok: true, resume: 'seek' },
    ],
    log,
  )
  const started = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    port,
  )
  assert.equal(started.status, RUNTIME_FALLBACK_STATUS.PLAYING)
  const continued = await orchestrator.notifyRuntimeFailure(123, port)
  assert.equal(continued?.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.equal(log.calls[1]?.resumePositionSeconds, 123)
  assert.equal(log.stops, 1)
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey, copyB.sourceTrackKey])
})

test('pause is not a playback failure', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const result = await orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort([{ ok: true, resume: 'none' }], log),
  )
  orchestrator.notifyPaused()
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.PLAYING)
  assert.equal(result.session.status, RUNTIME_FALLBACK_STATUS.PLAYING)
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  assert.equal(log.stops, 0)
})

test('next cancels the fallback session and leaves queue ownership outside the orchestrator', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const pending = deferred<PlaybackAttemptOutcome>()
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  let queueIndex = 2
  const running = orchestrator.run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort([{ pending: true }, { ok: true }], log, pending),
  )
  await Promise.resolve()
  orchestrator.cancel('next')
  queueIndex += 1
  pending.resolve({
    ok: false,
    positionSeconds: 8,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  })
  const result = await running
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.equal(orchestrator.getLastCancelReason(), 'next')
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  assert.equal(queueIndex, 3)
})

test('runtime fallback does not change the queue index', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  let queueIndex = 4
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 9 },
        { ok: true },
      ],
      log,
    ),
  )
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.equal(queueIndex, 4)
})

test('mid-playback failure resumes the next copy near the failed position', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 123 },
        { ok: true, resume: 'seek' },
      ],
      log,
    ),
  )
  assert.equal(log.calls[1]?.resumePositionSeconds, 123)
  assert.equal(result.resumeAttempted, true)
  assert.equal(result.resumeSucceeded, true)
  assert.equal(result.resumeUnsupported, false)
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
})

test('fallback still succeeds when seek is unsupported', async () => {
  const copyA = copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, copyB],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(copyB, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => trackFor(key === copyA.sourceTrackKey ? copyA : copyB),
    },
    scriptedPort(
      [
        { ok: false, positionSeconds: 123 },
        { ok: true, resume: 'unsupported' },
      ],
      log,
    ),
  )
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.equal(result.resumeUnsupported, true)
  assert.equal(result.resumeSucceeded, false)
  assert.equal(log.calls[1]?.resumePositionSeconds, 123)
})

test('a playable copy of another canonical track never enters the chain', async () => {
  const copyA = copyOf('alpha', 'a')
  const foreign = copyOf('beta', 'foreign', OTHER_CANONICAL_ID)
  const log: AttemptLog = { calls: [], stops: 0 }
  const result = await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [copyA, foreign],
      availability: availabilityOf([
        statusOf(copyA, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
        statusOf(foreign, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      preferredSourceTrackKey: copyA.sourceTrackKey,
      findTrack: (key) => {
        if (key === copyA.sourceTrackKey) {
          return trackFor(copyA)
        }
        if (key === foreign.sourceTrackKey) {
          return trackFor(foreign)
        }
        return null
      },
    },
    scriptedPort([{ ok: false, positionSeconds: 1 }], log),
  )
  assert.deepEqual(keysOf(log.calls), [copyA.sourceTrackKey])
  assert.equal(result.status, RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED)
})

test('fake discovery can return a candidate without joining the production fallback flow', async () => {
  const existing = copyOf('alpha', 'a')
  let discoveries = 0
  const fake: AlternateSourceDiscoveryProvider = {
    sourceId: 'future-provider',
    canDiscover(sourceId) {
      return sourceId === 'future-provider'
    },
    async discoverCopies() {
      discoveries += 1
      return {
        status: SOURCE_DISCOVERY_STATUS.FOUND,
        candidates: [
          {
            sourceId: 'future-provider',
            externalId: 'track-1',
            title: 'Song',
            artist: 'Artist',
            verified: true,
          },
        ],
      }
    },
  }
  const production = createProductionDiscoveryRegistry()
  assert.equal(production.list().length, 0)
  assert.equal(production.canDiscover('future-provider'), false)
  const found = await fake.discoverCopies({
    canonicalTrackId: CANONICAL_ID,
    title: 'Song',
    artist: 'Artist',
    existingCopies: [existing],
  })
  const copies = sourceCopiesFromDiscovery(CANONICAL_ID, found)
  assert.equal(found.status, SOURCE_DISCOVERY_STATUS.FOUND)
  assert.equal(copies.length, 1)
  assert.equal(copies[0]?.sourceTrackKey, 'future-provider:track-1')
  const ambiguous = sourceCopiesFromDiscovery(CANONICAL_ID, {
    status: SOURCE_DISCOVERY_STATUS.AMBIGUOUS,
    candidates: found.candidates,
  })
  const unverified = sourceCopiesFromDiscovery(CANONICAL_ID, {
    status: SOURCE_DISCOVERY_STATUS.FOUND,
    candidates: [{ ...found.candidates[0]!, verified: false }],
  })
  assert.equal(ambiguous.length, 0)
  assert.equal(unverified.length, 0)
  const log: AttemptLog = { calls: [], stops: 0 }
  await new RuntimePlaybackFallbackOrchestrator().run(
    {
      canonicalTrackId: CANONICAL_ID,
      copies: [existing],
      availability: availabilityOf([
        statusOf(existing, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE),
      ]),
      findTrack: () => trackFor(existing),
    },
    scriptedPort([{ ok: true, resume: 'none' }], log),
  )
  assert.equal(discoveries, 1)
  assert.equal(production.list().length, 0)
})
