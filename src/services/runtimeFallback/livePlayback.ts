import { canonicalItemForTrack } from '../canonical/selectors.ts'
import { sourceTrackKeyOf } from '../canonical/mapCanonical.ts'
import { findCollectionPlaybackTrack } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore.ts'
import type { SourceCopy } from '../../types/canonical.ts'
import type { CanonicalPlaybackAvailability } from '../../types/playbackAvailability.ts'
import {
  RUNTIME_FALLBACK_POLICY,
  RUNTIME_FALLBACK_STATUS,
  type PlaybackAttemptPort,
  type RuntimeFallbackPolicy,
  type RuntimeFallbackResult,
} from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import { createExistingPipelineAttemptPort } from './existingPlaybackAttempt.ts'
import {
  bindFallbackCancellation,
  bindMediaError,
  type FallbackCancelReason,
} from './fallbackControl.ts'
import { publishFallbackResult, dismissFallbackUx } from './fallbackUxPublish.ts'
import { RuntimePlaybackFallbackOrchestrator } from './RuntimePlaybackFallbackOrchestrator.ts'

export type LiveFallbackContext = {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
}

export type LivePlaybackDependencies = {
  lookup?: (track: Track) => LiveFallbackContext | null
  resolveAvailability?: (input: {
    canonicalTrackId: string
    copies: readonly SourceCopy[]
  }) => Promise<CanonicalPlaybackAvailability>
  findTrack?: (sourceTrackKey: string, requested: Track) => Track | null
  createAttemptPort?: () => PlaybackAttemptPort
  policy?: RuntimeFallbackPolicy
  orchestrator?: RuntimePlaybackFallbackOrchestrator
}

export type LivePlaybackRoute = {
  handled: boolean
  result: RuntimeFallbackResult | null
}

let liveOrchestrator: RuntimePlaybackFallbackOrchestrator | null = null
let mediaBound = false
let attemptDepth = 0

function getLiveOrchestrator(): RuntimePlaybackFallbackOrchestrator {
  if (!liveOrchestrator) {
    liveOrchestrator = new RuntimePlaybackFallbackOrchestrator()
  }
  return liveOrchestrator
}

function ensureMediaErrorBridge(): void {
  if (mediaBound) {
    return
  }
  mediaBound = true
  bindMediaError((positionSeconds) => {
    if (attemptDepth > 0) {
      return
    }
    const orchestrator = getLiveOrchestrator()
    const port = createGuardedAttemptPort(createExistingPipelineAttemptPort())
    void orchestrator.notifyRuntimeFailure(positionSeconds, port).then((result) => {
      publishFallbackResult(result, orchestrator.getGeneration())
    })
  })
}

/**
 * Единая граница playback.
 * Нет canonical или меньше двух известных копий — прежний source playback.
 * Иначе generic orchestrator. Каждая попытка — обычный source Track.
 */
export async function routeLivePlayback(
  track: Track,
  legacyPlay: (track: Track) => Promise<void>,
  dependencies: LivePlaybackDependencies = {},
): Promise<LivePlaybackRoute> {
  ensureMediaErrorBridge()
  const orchestrator = dependencies.orchestrator ?? getLiveOrchestrator()
  orchestrator.cancel('manual-play')
  const stamp = orchestrator.getGeneration()
  const lookup = dependencies.lookup ?? lookupKnownCopies
  const context = lookup(track)
  if (!context || context.copies.length < 2) {
    return { handled: false, result: null }
  }
  const resolveAvailability = dependencies.resolveAvailability ?? resolveKnownAvailability
  let availability: CanonicalPlaybackAvailability
  try {
    availability = await resolveAvailability({
      canonicalTrackId: context.canonicalTrackId,
      copies: context.copies,
    })
    if (orchestrator.getGeneration() !== stamp) {
      return { handled: true, result: null }
    }
  } catch {
    if (orchestrator.getGeneration() !== stamp) {
      return { handled: true, result: null }
    }
    await legacyPlay(track)
    return { handled: true, result: null }
  }
  const findTrack = dependencies.findTrack ?? findKnownPlaybackTrack
  const createPort = dependencies.createAttemptPort ?? createExistingPipelineAttemptPort
  const result = await orchestrator.run(
    {
      canonicalTrackId: context.canonicalTrackId,
      copies: context.copies,
      availability,
      preferredSourceTrackKey: sourceTrackKeyOf(track),
      policy: dependencies.policy ?? RUNTIME_FALLBACK_POLICY.AUTO,
      findTrack: (sourceTrackKey) => findTrack(sourceTrackKey, track),
    },
    createGuardedAttemptPort(createPort()),
  )
  if (result.status !== RUNTIME_FALLBACK_STATUS.CANCELLED) {
    publishFallbackResult(result, orchestrator.getGeneration(), track)
  }
  return { handled: true, result }
}

export async function confirmLiveFallback(): Promise<RuntimeFallbackResult | null> {
  const orchestrator = getLiveOrchestrator()
  const pending = usePlaybackFallbackUxStore.getState().model
  const decision = pending.kind === 'confirmation'
  if (!decision || pending.generation !== orchestrator.getGeneration()) {
    dismissFallbackUx()
    return null
  }
  const result = await orchestrator.confirmPending(
    createGuardedAttemptPort(createExistingPipelineAttemptPort()),
  )
  if (!result) {
    dismissFallbackUx()
    return null
  }
  publishFallbackResult(result, orchestrator.getGeneration(), usePlaybackFallbackUxStore.getState().requestedTrack)
  return result
}

export function bindLiveFallbackOrchestrator(orchestrator: RuntimePlaybackFallbackOrchestrator): void {
  bindFallbackCancellation((reason: FallbackCancelReason) => {
    orchestrator.cancel(reason)
    dismissFallbackUx()
  })
}

function createGuardedAttemptPort(port: PlaybackAttemptPort): PlaybackAttemptPort {
  return {
    stopPrevious() {
      return port.stopPrevious()
    },
    async attempt(request) {
      attemptDepth += 1
      try {
        return await port.attempt(request)
      } finally {
        attemptDepth -= 1
      }
    },
  }
}

function lookupKnownCopies(track: Track): LiveFallbackContext | null {
  const item = canonicalItemForTrack(useCanonicalLibraryStore.getState(), track)
  if (!item || item.copies.length < 2) {
    return null
  }
  return {
    canonicalTrackId: item.canonicalTrack.id,
    copies: item.copies,
  }
}

function resolveKnownAvailability(input: {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
}): Promise<CanonicalPlaybackAvailability> {
  return loadAvailability().then(({ resolveCanonicalPlaybackAvailability, createSourceRegistryAvailabilityPort }) =>
    resolveCanonicalPlaybackAvailability(input, {
      port: createSourceRegistryAvailabilityPort(),
    }),
  )
}

async function loadAvailability(): Promise<{
  resolveCanonicalPlaybackAvailability: typeof import('../playbackAvailability/resolveCanonicalPlaybackAvailability.ts').resolveCanonicalPlaybackAvailability
  createSourceRegistryAvailabilityPort: typeof import('../playbackAvailability/registryPort.ts').createSourceRegistryAvailabilityPort
}> {
  const [availability, registry] = await Promise.all([
    import('../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'),
    import('../playbackAvailability/registryPort.ts'),
  ])
  return {
    resolveCanonicalPlaybackAvailability: availability.resolveCanonicalPlaybackAvailability,
    createSourceRegistryAvailabilityPort: registry.createSourceRegistryAvailabilityPort,
  }
}

function findKnownPlaybackTrack(sourceTrackKey: string, requested: Track): Track | null {
  if (sourceTrackKey === sourceTrackKeyOf(requested) || sourceTrackKey === requested.id) {
    return requested
  }
  return findCollectionPlaybackTrack(sourceTrackKey)
}

bindLiveFallbackOrchestrator(getLiveOrchestrator())
