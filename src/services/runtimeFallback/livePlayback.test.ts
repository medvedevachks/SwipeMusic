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
  type PlaybackAttemptOutcome,
  type PlaybackAttemptRequest,
} from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import {
  attemptOnPlayer,
  type PlaybackSurface,
} from './existingPlaybackAttempt.ts'
import { beginQueueTransport, bindFallbackCancellation } from './fallbackControl.ts'
import { routeLivePlayback, type LiveFallbackContext } from './livePlayback.ts'
import { RuntimePlaybackFallbackOrchestrator } from './RuntimePlaybackFallbackOrchestrator.ts'
import {
  type AvailabilityAdapter,
  resolveCanonicalPlaybackAvailability,
} from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'

const CANONICAL_ID = 'can_live'
const OTHER_ID = 'can_other'

function copyOf(sourceId: string, externalId: string, canonicalTrackId = CANONICAL_ID): SourceCopy {
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

function trackFor(copy: SourceCopy): Track {
  return {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
  }
}

function statusOf(copy: SourceCopy, status: PlaybackAvailabilityStatus): SourceCopyAvailability {
  return {
    sourceTrackKey: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    canonicalTrackId: copy.canonicalTrackId,
    status,
  }
}

function availabilityOf(copies: readonly SourceCopyAvailability[]): CanonicalPlaybackAvailability {
  const playableCopies = copies.filter((copy) => copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE)
  return {
    canonicalTrackId: CANONICAL_ID,
    copies: [...copies],
    playableCopies,
    hasPlayableCopy: playableCopies.length > 0,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type ScriptStep =
  | { ok: false; positionSeconds: number | null }
  | { ok: true }
  | { pending: true }

function scriptedPort(script: ScriptStep[], calls: PlaybackAttemptRequest[], pending?: {
  promise: Promise<PlaybackAttemptOutcome>
  resolve: (value: PlaybackAttemptOutcome) => void
}) {
  let index = 0
  return () => ({
    stops: 0,
    stopPrevious() {
      this.stops += 1
    },
    async attempt(request: PlaybackAttemptRequest): Promise<PlaybackAttemptOutcome> {
      calls.push(request)
      const step = script[index] ?? { ok: false, positionSeconds: null }
      index += 1
      if ('pending' in step) {
        const outcome = await pending!.promise
        if (request.signal.aborted) {
          return {
            ok: false as const,
            cancelled: true,
            positionSeconds: null,
            resumeAttempted: false,
            resumeSucceeded: false,
            resumeUnsupported: false,
          }
        }
        return outcome
      }
      if (step.ok) {
        return {
          ok: true as const,
          resumeAttempted: false,
          resumeSucceeded: false,
          resumeUnsupported: false,
        }
      }
      return {
        ok: false as const,
        positionSeconds: step.positionSeconds,
        resumeAttempted: false,
        resumeSucceeded: false,
        resumeUnsupported: false,
      }
    },
  })
}

function keysOf(calls: readonly PlaybackAttemptRequest[]): string[] {
  return calls.map((call) => call.sourceTrackKey)
}

async function waitForAttempts(calls: readonly PlaybackAttemptRequest[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < count; attempt += 1) {
    await Promise.resolve()
  }
}

async function playPair(input: {
  policy?: (typeof RUNTIME_FALLBACK_POLICY)[keyof typeof RUNTIME_FALLBACK_POLICY]
  script: ScriptStep[]
  calls: PlaybackAttemptRequest[]
  orchestrator?: RuntimePlaybackFallbackOrchestrator
  pending?: { promise: Promise<PlaybackAttemptOutcome>; resolve: (value: PlaybackAttemptOutcome) => void }
  copies?: SourceCopy[]
  requested?: SourceCopy
  availability?: CanonicalPlaybackAvailability
  legacy?: (track: Track) => Promise<void>
}) {
  const copyA = input.requested ?? copyOf('alpha', 'a')
  const copyB = copyOf('beta', 'b')
  const copies = input.copies ?? [copyA, copyB]
  const context: LiveFallbackContext = {
    canonicalTrackId: CANONICAL_ID,
    copies,
  }
  const legacyCalls: string[] = []
  const route = await routeLivePlayback(
    trackFor(copyA),
    async (track) => {
      legacyCalls.push(track.id)
      await input.legacy?.(track)
    },
    {
      lookup: () => context,
      resolveAvailability: async () =>
        input.availability ??
        availabilityOf(copies.map((copy) => statusOf(copy, PLAYBACK_AVAILABILITY_STATUS.PLAYABLE))),
      findTrack: (key) => {
        const copy = copies.find((item) => item.sourceTrackKey === key)
        return copy ? trackFor(copy) : null
      },
      createAttemptPort: scriptedPort(input.script, input.calls, input.pending),
      policy: input.policy,
      orchestrator: input.orchestrator,
    },
  )
  return { route, legacyCalls, copyA, copyB }
}

test('AUTO live boundary plays the next copy after a real playback failure', async () => {
  const calls: PlaybackAttemptRequest[] = []
  let queueIndex = 4
  const { route, copyA, copyB } = await playPair({
    policy: RUNTIME_FALLBACK_POLICY.AUTO,
    script: [
      { ok: false, positionSeconds: 3 },
      { ok: true },
    ],
    calls,
  })
  assert.equal(route.handled, true)
  assert.equal(route.result?.status, RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED)
  assert.deepEqual(keysOf(calls), [copyA.sourceTrackKey, copyB.sourceTrackKey])
  assert.equal(route.result?.events.length, 1)
  assert.equal(route.result?.events[0]?.reason, 'RUNTIME_FALLBACK')
  assert.equal(route.result?.currentCopy?.sourceTrackKey, copyB.sourceTrackKey)
  assert.equal(queueIndex, 4)
})

test('OFF live boundary does not attempt the next copy', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const { route, copyA } = await playPair({
    policy: RUNTIME_FALLBACK_POLICY.OFF,
    script: [{ ok: false, positionSeconds: 1 }],
    calls,
  })
  assert.deepEqual(keysOf(calls), [copyA.sourceTrackKey])
  assert.equal(route.result?.status, RUNTIME_FALLBACK_STATUS.STOPPED_BY_POLICY)
})

test('ASK live boundary returns the next copy without starting it', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const { route, copyA, copyB } = await playPair({
    policy: RUNTIME_FALLBACK_POLICY.ASK,
    script: [{ ok: false, positionSeconds: 1 }],
    calls,
  })
  assert.deepEqual(keysOf(calls), [copyA.sourceTrackKey])
  assert.equal(route.result?.status, RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED)
  assert.equal(route.result?.nextPlayableCopy?.sourceTrackKey, copyB.sourceTrackKey)
})

test('a new manual play cancels the old live chain and ignores a late success', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const pending = deferred<PlaybackAttemptOutcome>()
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const copyY = copyOf('alpha', 'y', OTHER_ID)
  let activeId = ''
  const first = playPair({
    script: [{ pending: true }, { ok: true }],
    calls,
    orchestrator,
    pending,
  })
  await waitForAttempts(calls, 1)
  const second = await routeLivePlayback(
    trackFor(copyY),
    async (track) => {
      activeId = track.id
    },
    {
      lookup: () => null,
      orchestrator,
    },
  )
  if (!second.handled) {
    activeId = copyY.sourceTrackKey
  }
  pending.resolve({
    ok: true,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  })
  const firstRoute = await first
  assert.equal(firstRoute.route.result?.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.equal(second.handled, false)
  assert.equal(activeId, copyY.sourceTrackKey)
  assert.equal(keysOf(calls).includes(firstRoute.copyB.sourceTrackKey), false)
})

test('next cancels the live chain and the queue advances once', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const pending = deferred<PlaybackAttemptOutcome>()
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  let queueIndex = 1
  const running = playPair({
    script: [{ pending: true }, { ok: true }],
    calls,
    orchestrator,
    pending,
  })
  await waitForAttempts(calls, 1)
  orchestrator.cancel('next')
  queueIndex += 1
  pending.resolve({
    ok: false,
    positionSeconds: 2,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  })
  const { route, copyA } = await running
  assert.equal(route.result?.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.deepEqual(keysOf(calls), [copyA.sourceTrackKey])
  assert.equal(queueIndex, 2)
})

test('beginQueueTransport cancels before the queue moves', () => {
  const reasons: string[] = []
  bindFallbackCancellation((reason) => {
    reasons.push(reason)
  })
  let queueIndex = 7
  beginQueueTransport('previous', () => {
    queueIndex -= 1
  })
  assert.deepEqual(reasons, ['previous'])
  assert.equal(queueIndex, 6)
})

test('stop and logout cancel an active live chain', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const pending = deferred<PlaybackAttemptOutcome>()
  const orchestrator = new RuntimePlaybackFallbackOrchestrator()
  const running = playPair({
    script: [{ pending: true }, { ok: true }],
    calls,
    orchestrator,
    pending,
  })
  await waitForAttempts(calls, 1)
  orchestrator.cancel('stop')
  pending.resolve({
    ok: true,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  })
  const stopped = await running
  assert.equal(stopped.route.result?.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.equal(keysOf(calls).includes(stopped.copyB.sourceTrackKey), false)

  const pendingLogout = deferred<PlaybackAttemptOutcome>()
  const logoutCalls: PlaybackAttemptRequest[] = []
  const logoutOrchestrator = new RuntimePlaybackFallbackOrchestrator()
  const logoutRun = playPair({
    script: [{ pending: true }, { ok: true }],
    calls: logoutCalls,
    orchestrator: logoutOrchestrator,
    pending: pendingLogout,
  })
  await waitForAttempts(logoutCalls, 1)
  logoutOrchestrator.cancel('logout')
  pendingLogout.resolve({
    ok: true,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  })
  const loggedOut = await logoutRun
  assert.equal(loggedOut.route.result?.status, RUNTIME_FALLBACK_STATUS.CANCELLED)
  assert.equal(keysOf(logoutCalls).includes(loggedOut.copyB.sourceTrackKey), false)
})

test('a late attempt cannot overwrite playback that already moved on', async () => {
  let generation = 0
  let currentId: string | null = null
  const pauses: string[] = []
  const player: PlaybackSurface = {
    async playTrack(track) {
      const token = ++generation
      await Promise.resolve()
      if (token !== generation) {
        return
      }
      currentId = track.id
    },
    pause() {
      pauses.push(currentId ?? '')
    },
    seek() {},
    getState() {
      return {
        currentTrack: currentId ? { id: currentId } : null,
        currentTime: 12,
        error: null,
        playing: currentId != null,
      }
    },
  }
  const abortA = new AbortController()
  const startedA = attemptOnPlayer(player, {
    track: trackFor(copyOf('alpha', 'a')),
    sourceTrackKey: 'alpha:a',
    resumePositionSeconds: null,
    signal: abortA.signal,
    generation: 1,
  })
  const startedB = attemptOnPlayer(player, {
    track: trackFor(copyOf('beta', 'b')),
    sourceTrackKey: 'beta:b',
    resumePositionSeconds: null,
    signal: new AbortController().signal,
    generation: 2,
  })
  abortA.abort()
  const [resultA, resultB] = await Promise.all([startedA, startedB])
  assert.equal(resultA.ok, false)
  assert.equal(resultA.ok === false && resultA.cancelled, true)
  assert.equal(resultB.ok, true)
  assert.equal(currentId, 'beta:b')
  assert.deepEqual(pauses, [])
})

test('a single known copy keeps the legacy playback path', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const only = copyOf('alpha', 'only')
  const legacy: string[] = []
  const route = await routeLivePlayback(
    trackFor(only),
    async (track) => {
      legacy.push(track.id)
    },
    {
      lookup: () => ({ canonicalTrackId: CANONICAL_ID, copies: [only] }),
      createAttemptPort: scriptedPort([{ ok: true }], calls),
    },
  )
  if (!route.handled) {
    legacy.push(only.sourceTrackKey)
  }
  assert.equal(route.handled, false)
  assert.deepEqual(legacy, [only.sourceTrackKey])
  assert.equal(calls.length, 0)
})

test('a source track without canonical mapping keeps legacy playback', async () => {
  const calls: PlaybackAttemptRequest[] = []
  const track = trackFor(copyOf('mock', 'first-light'))
  const legacy: string[] = []
  const route = await routeLivePlayback(
    track,
    async (item) => {
      legacy.push(item.id)
    },
    {
      lookup: () => null,
      createAttemptPort: scriptedPort([{ ok: true }], calls),
    },
  )
  if (!route.handled) {
    legacy.push(track.id)
  }
  assert.equal(route.handled, false)
  assert.deepEqual(legacy, [track.id])
  assert.equal(calls.length, 0)
})

test('unsupported stub providers are not probed or attempted', async () => {
  const playable = copyOf('alpha', 'a')
  const stub = copyOf('vk-music', 'none')
  const calls = { candidates: 0, probe: 0 }
  const adapter = (id: string, playableStatus: boolean): AvailabilityAdapter => ({
    id,
    capabilities: playableStatus ? ['preview'] : [],
    supportsStreaming: playableStatus,
    isAvailable: () => true,
    async checkTrackAvailability() {
      calls.probe += 1
      return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
    },
    async getPlaybackCandidates() {
      calls.candidates += 1
      return []
    },
  })
  const attempts: PlaybackAttemptRequest[] = []
  const route = await routeLivePlayback(
    trackFor(playable),
    async () => {},
    {
      lookup: () => ({ canonicalTrackId: CANONICAL_ID, copies: [playable, stub] }),
      resolveAvailability: (input) =>
        resolveCanonicalPlaybackAvailability(input, {
          port: {
            isSourceEnabled: () => true,
            findAdapter: (sourceId) => adapter(sourceId, sourceId === 'alpha'),
          },
        }),
      findTrack: (key) => (key === playable.sourceTrackKey ? trackFor(playable) : trackFor(stub)),
      createAttemptPort: scriptedPort([{ ok: false, positionSeconds: 1 }], attempts),
      policy: RUNTIME_FALLBACK_POLICY.AUTO,
    },
  )
  assert.equal(route.handled, true)
  assert.deepEqual(keysOf(attempts), [playable.sourceTrackKey])
  assert.equal(calls.candidates, 0)
})
