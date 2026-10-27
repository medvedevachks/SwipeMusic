import { mergeRanges, rangesLength, type ListenRange } from './listenedRange.ts'
import {
  PLAYBACK_ANALYTICS_LIMITS,
  PLAYBACK_EVENT,
  PLAYBACK_REASON,
  type AnalyticsCommand,
  type PlaybackEvent,
  type PlaybackReason,
  type TrackIdentityRef,
} from './types.ts'

type OpenSession = {
  id: string
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  started: boolean
  closed: boolean
  completed: boolean
  paused: boolean
  sourceSwitch: boolean
  durationMs: number | null
  positionMs: number
  listenedMs: number
  ranges: ListenRange[]
  cursorMs: number | null
  progressEmitted: number
  lastProgressListenedMs: number
  ordinal: number
}

export class PlaybackAnalyticsMachine {
  private session: OpenSession | null = null
  private readonly now: () => string
  private readonly newId: () => string

  constructor(now: () => string, newId: () => string) {
    this.now = now
    this.newId = newId
  }

  reset(): void {
    this.session = null
  }

  apply(command: AnalyticsCommand): PlaybackEvent[] {
    switch (command.type) {
      case 'deck-gesture':
        return []
      case 'intent':
        return this.onIntent(command)
      case 'audible':
        return this.onAudible(command)
      case 'time':
        return this.onTime(command.positionMs)
      case 'seek':
        return this.onSeek(command.positionMs)
      case 'paused':
        return this.onPaused(command.positionMs)
      case 'resumed':
        return this.onResumed(command.positionMs)
      case 'ended':
        return this.onEnded(command.positionMs, command.durationMs)
      case 'failed':
        return this.onFailed(command)
      case 'skip':
        return this.onSkip(command.reason, command.positionMs)
      default: {
        const _exhaustive: never = command
        void _exhaustive
        return []
      }
    }
  }

  private onIntent(command: { preserveQueue: boolean } & TrackIdentityRef): PlaybackEvent[] {
    const session = this.open()
    if (!session) {
      return []
    }
    if (command.preserveQueue || this.sameCanonical(session, command)) {
      session.sourceSwitch = true
      if (command.canonicalTrackId) {
        session.canonicalTrackId = command.canonicalTrackId
      }
      return []
    }
    if (this.sameSource(session, command)) {
      return []
    }
    return this.onSkip(PLAYBACK_REASON.REPLACED, session.positionMs)
  }

  private onAudible(command: { positionMs: number; durationMs: number | null } & TrackIdentityRef): PlaybackEvent[] {
    const session = this.open()
    if (session && (session.sourceSwitch || this.sameCanonical(session, command))) {
      session.sourceId = command.sourceId
      session.externalId = command.externalId
      session.canonicalTrackId = command.canonicalTrackId ?? session.canonicalTrackId
      session.sourceSwitch = false
      session.paused = false
      if (command.durationMs != null) {
        session.durationMs = command.durationMs
      }
      session.cursorMs = command.positionMs
      session.positionMs = command.positionMs
      if (!session.started) {
        return this.markStarted(session)
      }
      return []
    }
    if (session && this.sameSource(session, command)) {
      session.paused = false
      session.cursorMs = command.positionMs
      session.positionMs = command.positionMs
      if (command.durationMs != null) {
        session.durationMs = command.durationMs
      }
      if (!session.started) {
        return this.markStarted(session)
      }
      return []
    }
    const replaced = session ? this.onSkip(PLAYBACK_REASON.REPLACED, session.positionMs) : []
    const opened = this.openFresh(command, command.durationMs, command.positionMs)
    return [...replaced, ...this.markStarted(opened)]
  }

  private onTime(positionMs: number): PlaybackEvent[] {
    const session = this.playing()
    if (!session) {
      return []
    }
    this.absorb(session, positionMs, true)
    return this.maybeProgress(session)
  }

  private onSeek(positionMs: number): PlaybackEvent[] {
    const session = this.open()
    if (!session) {
      return []
    }
    session.positionMs = Math.max(0, positionMs)
    session.cursorMs = session.positionMs
    return []
  }

  private onPaused(positionMs: number): PlaybackEvent[] {
    const session = this.playing()
    if (!session) {
      return []
    }
    this.absorb(session, positionMs, true)
    session.paused = true
    return [this.event(session, PLAYBACK_EVENT.PAUSED, null)]
  }

  private onResumed(positionMs: number): PlaybackEvent[] {
    const session = this.open()
    if (!session?.started || !session.paused) {
      return []
    }
    session.positionMs = Math.max(0, positionMs)
    session.cursorMs = session.positionMs
    session.paused = false
    return [this.event(session, PLAYBACK_EVENT.RESUMED, null)]
  }

  private onEnded(positionMs: number, durationMs: number | null): PlaybackEvent[] {
    const session = this.open()
    if (!session?.started || session.completed) {
      return []
    }
    if (durationMs != null) {
      session.durationMs = durationMs
    }
    this.absorb(session, positionMs, true)
    session.completed = true
    session.closed = true
    session.paused = false
    return [this.event(session, PLAYBACK_EVENT.COMPLETED, null)]
  }

  private onFailed(command: TrackIdentityRef & { reason: PlaybackEvent['reason'] }): PlaybackEvent[] {
    const session = this.open()
    if (session?.sourceSwitch) {
      session.sourceSwitch = false
      return []
    }
    if (session?.started) {
      session.closed = true
      session.paused = true
      return [this.event(session, PLAYBACK_EVENT.FAILED, command.reason)]
    }
    const attempt = this.openFresh(command, null, 0)
    attempt.closed = true
    return [this.event(attempt, PLAYBACK_EVENT.FAILED, command.reason)]
  }

  private onSkip(reason: PlaybackEvent['reason'], positionMs: number): PlaybackEvent[] {
    const session = this.open()
    if (!session?.started || session.completed) {
      return []
    }
    this.absorb(session, positionMs, false)
    session.positionMs = Math.max(0, positionMs)
    session.closed = true
    session.paused = true
    return [this.event(session, PLAYBACK_EVENT.SKIPPED, reason)]
  }

  private markStarted(session: OpenSession): PlaybackEvent[] {
    session.started = true
    return [this.event(session, PLAYBACK_EVENT.STARTED, null)]
  }

  private maybeProgress(session: OpenSession): PlaybackEvent[] {
    if (session.progressEmitted >= PLAYBACK_ANALYTICS_LIMITS.maxProgressPerSession) {
      return []
    }
    if (session.listenedMs - session.lastProgressListenedMs < PLAYBACK_ANALYTICS_LIMITS.progressIntervalMs) {
      return []
    }
    session.progressEmitted += 1
    session.lastProgressListenedMs = session.listenedMs
    return [this.event(session, PLAYBACK_EVENT.PROGRESS, null)]
  }

  private absorb(session: OpenSession, positionMs: number, countForward: boolean): void {
    const position = Math.max(0, positionMs)
    const cursor = session.cursorMs
    session.positionMs = position
    if (countForward && cursor != null) {
      const delta = position - cursor
      if (delta > 0 && delta <= PLAYBACK_ANALYTICS_LIMITS.maxStepMs) {
        session.ranges = mergeRanges(session.ranges, cursor, position)
        session.listenedMs = rangesLength(session.ranges)
      }
    }
    session.cursorMs = position
  }

  private event(
    session: OpenSession,
    eventType: PlaybackEvent['eventType'],
    reason: PlaybackReason | null,
  ): PlaybackEvent {
    session.ordinal += 1
    const suffix = eventType === PLAYBACK_EVENT.STARTED
      || eventType === PLAYBACK_EVENT.COMPLETED
      || eventType === PLAYBACK_EVENT.SKIPPED
      ? eventType
      : `${eventType}_${session.ordinal}`
    return {
      eventId: `${session.id}_${suffix}`,
      sessionId: session.id,
      eventType,
      sourceId: session.sourceId,
      externalId: session.externalId,
      canonicalTrackId: session.canonicalTrackId,
      positionMs: session.positionMs,
      listenedMs: session.listenedMs,
      durationMs: session.durationMs,
      reason,
      createdAt: this.now(),
    }
  }

  private open(): OpenSession | null {
    if (!this.session || this.session.closed) {
      return null
    }
    return this.session
  }

  private playing(): OpenSession | null {
    const session = this.open()
    if (!session?.started || session.paused) {
      return null
    }
    return session
  }

  private openFresh(identity: TrackIdentityRef, durationMs: number | null, positionMs: number): OpenSession {
    const session: OpenSession = {
      id: this.newId(),
      sourceId: identity.sourceId,
      externalId: identity.externalId,
      canonicalTrackId: identity.canonicalTrackId,
      started: false,
      closed: false,
      completed: false,
      paused: false,
      sourceSwitch: false,
      durationMs,
      positionMs: Math.max(0, positionMs),
      listenedMs: 0,
      ranges: [],
      cursorMs: Math.max(0, positionMs),
      progressEmitted: 0,
      lastProgressListenedMs: 0,
      ordinal: 0,
    }
    this.session = session
    return session
  }

  private sameSource(session: OpenSession, identity: TrackIdentityRef): boolean {
    return session.sourceId === identity.sourceId && session.externalId === identity.externalId
  }

  private sameCanonical(session: OpenSession, identity: TrackIdentityRef): boolean {
    return Boolean(
      session.canonicalTrackId
      && identity.canonicalTrackId
      && session.canonicalTrackId === identity.canonicalTrackId
      && !this.sameSource(session, identity),
    )
  }
}
