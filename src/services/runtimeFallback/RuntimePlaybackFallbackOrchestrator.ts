import type { SourceCopy } from '../../types/canonical.ts'
import type { CanonicalPlaybackAvailability } from '../../types/playbackAvailability.ts'
import {
  RUNTIME_FALLBACK_POLICY,
  RUNTIME_FALLBACK_STATUS,
  type FailedPlaybackCopy,
  type PlaybackAttemptOutcome,
  type PlaybackAttemptPort,
  type PlaybackFallbackSession,
  type PlaybackSourceChanged,
  type RegisteredSourceDescriptor,
  type RuntimeFallbackPolicy,
  type RuntimeFallbackResult,
  type RuntimeFallbackStatus,
} from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import { getPlaybackTrackForSourceCopy } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import {
  groupKnownAlternatives,
  orderPlayableCopies,
} from './orderPlayableCopies.ts'

export type RunRuntimeFallbackInput = {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  availability: CanonicalPlaybackAvailability
  preferredSourceTrackKey?: string | null
  policy?: RuntimeFallbackPolicy
  findTrack: (sourceTrackKey: string) => Track | null
  registeredSources?: readonly RegisteredSourceDescriptor[]
  now?: number
}

type ActiveRun = {
  generation: number
  abort: AbortController
  input: RunRuntimeFallbackInput
  policy: RuntimeFallbackPolicy
  attempted: SourceCopy[]
  failed: FailedPlaybackCopy[]
  events: PlaybackSourceChanged[]
  session: PlaybackFallbackSession
  resumeAttempted: boolean
  resumeSucceeded: boolean
  resumeUnsupported: boolean
}

/**
 * Выбор и попытки playback только по известным PLAYABLE SourceCopy.
 * Не знает имён провайдеров, не ищет новые копии и не меняет очередь.
 */
export class RuntimePlaybackFallbackOrchestrator {
  private generation = 0
  private active: ActiveRun | null = null
  private lastCancelReason: 'next' | 'previous' | 'manual-play' | 'logout' | 'stop' | null = null
  private readonly listeners = new Set<(event: PlaybackSourceChanged) => void>()

  subscribe(listener: (event: PlaybackSourceChanged) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Next, Previous, Stop, новый ручной Play и logout гасят сессию. Pause сюда не входит. */
  cancel(reason: 'next' | 'previous' | 'manual-play' | 'logout' | 'stop' = 'manual-play'): void {
    this.lastCancelReason = reason
    this.generation += 1
    this.active?.abort.abort()
    if (this.active) {
      this.active.session.status = RUNTIME_FALLBACK_STATUS.CANCELLED
    }
  }

  /**
   * ASK оставил ту же сессию на CONFIRMATION_REQUIRED.
   * Подтверждение продолжает её. Новое поколение или другой статус — ничего не запускает.
   */
  confirmPending(port: PlaybackAttemptPort): Promise<RuntimeFallbackResult | null> {
    const active = this.active
    if (!active || !this.isCurrent(active)) {
      return Promise.resolve(null)
    }
    if (active.session.status !== RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED) {
      return Promise.resolve(null)
    }
    return this.attemptNext(active, port, active.session.resumePositionSeconds, false)
  }

  /** Пауза не является ошибкой playback и fallback не запускает. */
  notifyPaused(): void {}

  getLastCancelReason(): 'next' | 'previous' | 'manual-play' | 'logout' | 'stop' | null {
    return this.lastCancelReason
  }

  getGeneration(): number {
    return this.generation
  }

  /**
   * Реальная ошибка уже начатого playback.
   * Pause и смена трека сюда не попадают.
   */
  async notifyRuntimeFailure(
    positionSeconds: number | null,
    port: PlaybackAttemptPort,
  ): Promise<RuntimeFallbackResult | null> {
    const active = this.active
    if (!active || !isLiveStatus(active.session.status)) {
      return null
    }
    const current = active.attempted[active.attempted.length - 1]
    if (!current) {
      return null
    }
    active.failed.push({ copy: current, positionSeconds })
    active.session.resumePositionSeconds = positionSeconds
    return this.continueAfterFailure(active, port, positionSeconds)
  }

  async run(
    input: RunRuntimeFallbackInput,
    port: PlaybackAttemptPort,
  ): Promise<RuntimeFallbackResult> {
    this.cancel('manual-play')
    const generation = this.generation
    const policy = input.policy ?? RUNTIME_FALLBACK_POLICY.AUTO
    const startedAt = new Date(input.now ?? Date.now()).toISOString()
    const active: ActiveRun = {
      generation,
      abort: new AbortController(),
      input,
      policy,
      attempted: [],
      failed: [],
      events: [],
      resumeAttempted: false,
      resumeSucceeded: false,
      resumeUnsupported: false,
      session: {
        sessionId: `fb_${generation}_${input.canonicalTrackId}`,
        canonicalTrackId: input.canonicalTrackId,
        requestedSourceTrackKey: input.preferredSourceTrackKey ?? null,
        policy,
        attemptedSourceTrackKeys: [],
        currentSourceTrackKey: null,
        startedAt,
        resumePositionSeconds: null,
        status: RUNTIME_FALLBACK_STATUS.PLAYING,
      },
    }
    this.active = active
    return this.attemptNext(active, port, null, false)
  }

  private async continueAfterFailure(
    active: ActiveRun,
    port: PlaybackAttemptPort,
    positionSeconds: number | null,
  ): Promise<RuntimeFallbackResult> {
    if (active.policy === RUNTIME_FALLBACK_POLICY.OFF) {
      const next = this.peekNext(active)
      return this.finish(
        active,
        next ? RUNTIME_FALLBACK_STATUS.STOPPED_BY_POLICY : RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED,
        next,
      )
    }
    if (active.policy === RUNTIME_FALLBACK_POLICY.ASK) {
      const next = this.peekNext(active)
      if (!next) {
        return this.finish(active, RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED, null)
      }
      return this.finish(active, RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED, next)
    }
    return this.attemptNext(active, port, positionSeconds, true)
  }

  private async attemptNext(
    active: ActiveRun,
    port: PlaybackAttemptPort,
    resumePositionSeconds: number | null,
    afterFailure: boolean,
  ): Promise<RuntimeFallbackResult> {
    if (!this.isCurrent(active)) {
      return this.finish(active, RUNTIME_FALLBACK_STATUS.CANCELLED, null)
    }

    const next = this.peekNext(active)
    if (!next) {
      if (active.attempted.length === 0) {
        const missingOnly = this.missingSnapshotBlocks(active)
        return this.finish(
          active,
          missingOnly
            ? RUNTIME_FALLBACK_STATUS.TRACK_SNAPSHOT_MISSING
            : RUNTIME_FALLBACK_STATUS.NO_PLAYABLE_COPY,
          null,
        )
      }
      return this.finish(active, RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED, null)
    }

    if (active.policy === RUNTIME_FALLBACK_POLICY.OFF && active.attempted.length >= 1) {
      return this.finish(active, RUNTIME_FALLBACK_STATUS.STOPPED_BY_POLICY, next)
    }
    if (
      active.policy === RUNTIME_FALLBACK_POLICY.ASK &&
      afterFailure &&
      active.attempted.length >= 1
    ) {
      return this.finish(active, RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED, next)
    }

    const snapshot = getPlaybackTrackForSourceCopy(next, active.input.findTrack)
    active.session.attemptedSourceTrackKeys.push(next.sourceTrackKey)
    if (!snapshot.track) {
      if (this.peekNext(active)) {
        return this.attemptNext(active, port, resumePositionSeconds, afterFailure)
      }
      return this.finish(
        active,
        active.attempted.length > 0
          ? RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED
          : RUNTIME_FALLBACK_STATUS.TRACK_SNAPSHOT_MISSING,
        null,
      )
    }

    if (active.attempted.length > 0) {
      if (!this.isCurrent(active)) {
        return this.finish(active, RUNTIME_FALLBACK_STATUS.CANCELLED, null)
      }
      const previous = active.attempted[active.attempted.length - 1]!
      await port.stopPrevious()
      if (!this.isCurrent(active)) {
        return this.finish(active, RUNTIME_FALLBACK_STATUS.CANCELLED, null)
      }
      this.emit(active, {
        canonicalTrackId: active.input.canonicalTrackId,
        fromSourceTrackKey: previous.sourceTrackKey,
        toSourceTrackKey: next.sourceTrackKey,
        reason: 'RUNTIME_FALLBACK',
      })
    }

    active.attempted.push(next)
    active.session.currentSourceTrackKey = next.sourceTrackKey
    active.session.resumePositionSeconds = resumePositionSeconds
    const outcome = await port.attempt({
      track: snapshot.track,
      sourceTrackKey: next.sourceTrackKey,
      resumePositionSeconds,
      signal: active.abort.signal,
      generation: active.generation,
    })
    this.noteResume(active, outcome)

    const cancelled =
      !this.isCurrent(active) ||
      active.abort.signal.aborted ||
      (outcome.ok === false && outcome.cancelled === true)
    if (cancelled) {
      if (this.isCurrent(active)) {
        await port.stopPrevious()
      }
      return this.finish(active, RUNTIME_FALLBACK_STATUS.CANCELLED, null)
    }
    if (outcome.ok) {
      const status =
        active.failed.length > 0
          ? RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED
          : RUNTIME_FALLBACK_STATUS.PLAYING
      active.session.status = status
      return this.resultOf(active, status, null)
    }

    active.failed.push({ copy: next, positionSeconds: outcome.positionSeconds })
    active.session.resumePositionSeconds = outcome.positionSeconds
    return this.continueAfterFailure(active, port, outcome.positionSeconds)
  }

  private peekNext(active: ActiveRun): SourceCopy | null {
    const ordered = orderPlayableCopies({
      canonicalTrackId: active.input.canonicalTrackId,
      copies: active.input.copies,
      availability: active.input.availability,
      preferredSourceTrackKey: active.input.preferredSourceTrackKey,
      attemptedSourceTrackKeys: active.session.attemptedSourceTrackKeys,
    })
    return ordered[0] ?? null
  }

  private missingSnapshotBlocks(active: ActiveRun): boolean {
    const ordered = orderPlayableCopies({
      canonicalTrackId: active.input.canonicalTrackId,
      copies: active.input.copies,
      availability: active.input.availability,
      preferredSourceTrackKey: active.input.preferredSourceTrackKey,
    })
    return (
      ordered.length > 0 &&
      ordered.every((copy) => !getPlaybackTrackForSourceCopy(copy, active.input.findTrack).track)
    )
  }

  private noteResume(active: ActiveRun, outcome: PlaybackAttemptOutcome): void {
    if (outcome.resumeAttempted) {
      active.resumeAttempted = true
    }
    if (outcome.resumeSucceeded) {
      active.resumeSucceeded = true
    }
    if (outcome.resumeUnsupported) {
      active.resumeUnsupported = true
    }
  }

  private emit(active: ActiveRun, event: PlaybackSourceChanged): void {
    active.events.push(event)
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private isCurrent(active: ActiveRun): boolean {
    return this.generation === active.generation && this.active === active
  }

  private finish(
    active: ActiveRun,
    status: RuntimeFallbackStatus,
    nextPlayableCopy: SourceCopy | null,
  ): RuntimeFallbackResult {
    active.session.status = status
    if (
      this.active === active &&
      !isLiveStatus(status) &&
      status !== RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED
    ) {
      this.active = null
    }
    if (status === RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED) {
      active.session.status = status
    }
    return this.resultOf(active, status, nextPlayableCopy)
  }

  private resultOf(
    active: ActiveRun,
    status: RuntimeFallbackStatus,
    nextPlayableCopy: SourceCopy | null,
  ): RuntimeFallbackResult {
    const inventorySources = active.input.registeredSources ?? []
    const knownSourceIds = new Set(
      active.input.copies
        .filter((copy) => copy.canonicalTrackId === active.input.canonicalTrackId)
        .map((copy) => copy.sourceId),
    )
    return {
      status,
      session: {
        ...active.session,
        attemptedSourceTrackKeys: [...active.session.attemptedSourceTrackKeys],
        status,
      },
      attemptedCopies: [...active.attempted],
      failedCopies: [...active.failed],
      knownAvailability: active.input.availability,
      currentCopy: active.attempted[active.attempted.length - 1] ?? null,
      nextPlayableCopy,
      alternatives: groupKnownAlternatives({
        canonicalTrackId: active.input.canonicalTrackId,
        copies: active.input.copies,
        availability: active.input.availability,
      }),
      registeredSourcesWithoutCopy: inventorySources.filter(
        (source) => !knownSourceIds.has(source.sourceId),
      ),
      events: [...active.events],
      resumeAttempted: active.resumeAttempted,
      resumeSucceeded: active.resumeSucceeded,
      resumeUnsupported: active.resumeUnsupported,
    }
  }
}

function isLiveStatus(status: RuntimeFallbackStatus): boolean {
  return (
    status === RUNTIME_FALLBACK_STATUS.PLAYING ||
    status === RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED
  )
}
