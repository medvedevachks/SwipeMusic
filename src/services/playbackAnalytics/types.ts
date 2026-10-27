/** Сырые факты прослушивания. Это не оценка вкуса и не лайк. */

export const PLAYBACK_EVENT = {
  STARTED: 'playback_started',
  PROGRESS: 'playback_progress',
  COMPLETED: 'playback_completed',
  SKIPPED: 'playback_skipped',
  PAUSED: 'playback_paused',
  RESUMED: 'playback_resumed',
  FAILED: 'playback_failed',
} as const

export type PlaybackEventType = (typeof PLAYBACK_EVENT)[keyof typeof PLAYBACK_EVENT]

export const PLAYBACK_REASON = {
  NEXT: 'next',
  PREVIOUS: 'previous',
  REPLACED: 'replaced',
  STOP: 'stop',
  LOAD_FAILED: 'load-failed',
  PLAYBACK_FAILED: 'playback-failed',
} as const

export type PlaybackReason = (typeof PLAYBACK_REASON)[keyof typeof PLAYBACK_REASON]

export const PLAYBACK_ANALYTICS_LIMITS = {
  /** Шаг времени больше этого — перемотка, в длительность не входит. */
  maxStepMs: 5_000,
  progressIntervalMs: 15_000,
  maxProgressPerSession: 8,
  /** Короче этого ранний пропуск не считается содержательным сигналом. */
  earlySkipMs: 5_000,
  earlySkipRatio: 0.3,
  heardRatio: 0.5,
  heardMs: 30_000,
} as const

export type PlaybackEvent = {
  eventId: string
  sessionId: string
  eventType: PlaybackEventType
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  positionMs: number
  listenedMs: number
  durationMs: number | null
  reason: PlaybackReason | null
  createdAt: string
}

export type TrackIdentityRef = {
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
}

export type AnalyticsCommand =
  | ({ type: 'intent'; preserveQueue: boolean } & TrackIdentityRef)
  | ({ type: 'audible'; positionMs: number; durationMs: number | null } & TrackIdentityRef)
  | { type: 'time'; positionMs: number }
  | { type: 'seek'; positionMs: number }
  | { type: 'paused'; positionMs: number }
  | { type: 'resumed'; positionMs: number }
  | { type: 'ended'; positionMs: number; durationMs: number | null }
  | ({ type: 'failed'; reason: typeof PLAYBACK_REASON.LOAD_FAILED | typeof PLAYBACK_REASON.PLAYBACK_FAILED } & TrackIdentityRef)
  | { type: 'skip'; reason: typeof PLAYBACK_REASON.NEXT | typeof PLAYBACK_REASON.PREVIOUS | typeof PLAYBACK_REASON.STOP | typeof PLAYBACK_REASON.REPLACED; positionMs: number }
  | { type: 'deck-gesture' }
