import type { SourceCopy } from './canonical.ts'
import type { CanonicalPlaybackAvailability } from './playbackAvailability.ts'
import type { Track } from './track.ts'

/**
 * Политика повторной попытки после реальной ошибки playback.
 * Car Mode позже использует тот же AUTO, без отдельного плеера.
 */
export const RUNTIME_FALLBACK_POLICY = {
  OFF: 'OFF',
  ASK: 'ASK',
  AUTO: 'AUTO',
} as const

export type RuntimeFallbackPolicy =
  (typeof RUNTIME_FALLBACK_POLICY)[keyof typeof RUNTIME_FALLBACK_POLICY]

export const RUNTIME_FALLBACK_STATUS = {
  PLAYING: 'PLAYING',
  FALLBACK_SUCCEEDED: 'FALLBACK_SUCCEEDED',
  NO_PLAYABLE_COPY: 'NO_PLAYABLE_COPY',
  ALL_PLAYABLE_COPIES_FAILED: 'ALL_PLAYABLE_COPIES_FAILED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  TRACK_SNAPSHOT_MISSING: 'TRACK_SNAPSHOT_MISSING',
  STOPPED_BY_POLICY: 'STOPPED_BY_POLICY',
  CANCELLED: 'CANCELLED',
} as const

export type RuntimeFallbackStatus =
  (typeof RUNTIME_FALLBACK_STATUS)[keyof typeof RUNTIME_FALLBACK_STATUS]

export const SOURCE_DISCOVERY_STATUS = {
  FOUND: 'FOUND',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
  UNSUPPORTED: 'UNSUPPORTED',
  ERROR: 'ERROR',
} as const

export type SourceDiscoveryStatus =
  (typeof SOURCE_DISCOVERY_STATUS)[keyof typeof SOURCE_DISCOVERY_STATUS]

/** Эфемерная сессия. В SQLite не пишется. */
export type PlaybackFallbackSession = {
  sessionId: string
  canonicalTrackId: string
  requestedSourceTrackKey: string | null
  policy: RuntimeFallbackPolicy
  attemptedSourceTrackKeys: string[]
  currentSourceTrackKey: string | null
  startedAt: string
  resumePositionSeconds: number | null
  status: RuntimeFallbackStatus
}

export type PlaybackSourceChanged = {
  canonicalTrackId: string
  fromSourceTrackKey: string
  toSourceTrackKey: string
  reason: 'RUNTIME_FALLBACK'
}

export type RegisteredSourceDescriptor = {
  sourceId: string
  enabled: boolean
  capabilities: readonly string[]
}

export type CanonicalSourceInventory = {
  canonicalTrackId: string
  knownCopies: SourceCopy[]
  registeredSources: RegisteredSourceDescriptor[]
  /** Зарегистрированные источники без известной SourceCopy этой композиции. */
  registeredSourcesWithoutCopy: RegisteredSourceDescriptor[]
}

export type ActionableKnownAlternatives = {
  subscriptionRequiredCopies: SourceCopy[]
  notConnectedCopies: SourceCopy[]
  authRequiredCopies: SourceCopy[]
  unavailableCopies: SourceCopy[]
  unknownCopies: SourceCopy[]
  unsupportedCopies: SourceCopy[]
}

export type FailedPlaybackCopy = {
  copy: SourceCopy
  positionSeconds: number | null
}

export type RuntimeFallbackResult = {
  status: RuntimeFallbackStatus
  session: PlaybackFallbackSession
  attemptedCopies: SourceCopy[]
  failedCopies: FailedPlaybackCopy[]
  knownAvailability: CanonicalPlaybackAvailability
  currentCopy: SourceCopy | null
  nextPlayableCopy: SourceCopy | null
  alternatives: ActionableKnownAlternatives
  registeredSourcesWithoutCopy: RegisteredSourceDescriptor[]
  events: PlaybackSourceChanged[]
  resumeAttempted: boolean
  resumeSucceeded: boolean
  resumeUnsupported: boolean
}

export type PlaybackAttemptRequest = {
  track: Track
  sourceTrackKey: string
  resumePositionSeconds: number | null
  signal: AbortSignal
  generation: number
}

export type PlaybackAttemptOutcome =
  | {
      ok: true
      resumeAttempted: boolean
      resumeSucceeded: boolean
      resumeUnsupported: boolean
    }
  | {
      ok: false
      cancelled?: boolean
      positionSeconds: number | null
      resumeAttempted: boolean
      resumeSucceeded: boolean
      resumeUnsupported: boolean
    }

/**
 * Одна попытка существующего source-track playback.
 * Тесты подставляют fake. Production-адаптер вызывает текущий AudioPlayer.
 */
export type PlaybackAttemptPort = {
  attempt(request: PlaybackAttemptRequest): Promise<PlaybackAttemptOutcome>
  stopPrevious(): void | Promise<void>
}

export type DiscoveryCandidate = {
  sourceId: string
  externalId: string
  title: string
  artist: string
  /** Совпадение подтверждено. Похожие title/artist без флага — не SourceCopy. */
  verified: boolean
}

export type SourceDiscoveryResult = {
  status: SourceDiscoveryStatus
  candidates: DiscoveryCandidate[]
}

export type DiscoverCopiesInput = {
  canonicalTrackId: string
  title: string
  artist: string
  existingCopies: readonly SourceCopy[]
}
