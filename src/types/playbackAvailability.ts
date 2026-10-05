/**
 * Эфемерная возможность воспроизвести SourceCopy.
 * Это не CanonicalTrack, не очередь и не выбранный источник.
 */

export const PLAYBACK_AVAILABILITY_STATUS = {
  PLAYABLE: 'PLAYABLE',
  NOT_CONNECTED: 'NOT_CONNECTED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNSUPPORTED: 'UNSUPPORTED',
  UNKNOWN: 'UNKNOWN',
} as const

export type PlaybackAvailabilityStatus =
  (typeof PLAYBACK_AVAILABILITY_STATUS)[keyof typeof PLAYBACK_AVAILABILITY_STATUS]

/** Машинный код. Не текст для пользователя и не секрет провайдера. */
export const PLAYBACK_AVAILABILITY_REASON = {
  SOURCE_COPY_MISSING: 'SOURCE_COPY_MISSING',
  ADAPTER_MISSING: 'ADAPTER_MISSING',
  PLAYBACK_UNSUPPORTED: 'PLAYBACK_UNSUPPORTED',
  SOURCE_DISABLED: 'SOURCE_DISABLED',
  NOT_CONNECTED: 'NOT_CONNECTED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  LOCAL_HANDLE_MISSING: 'LOCAL_HANDLE_MISSING',
  TRACK_MISSING: 'TRACK_MISSING',
  NETWORK: 'NETWORK',
  NOT_CHECKED: 'NOT_CHECKED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const

export type PlaybackAvailabilityReason =
  (typeof PLAYBACK_AVAILABILITY_REASON)[keyof typeof PLAYBACK_AVAILABILITY_REASON]

export type TrackAvailabilityProbe = {
  status: PlaybackAvailabilityStatus
  reason?: PlaybackAvailabilityReason
}

export type SourceCopyAvailability = {
  sourceTrackKey: string
  sourceId: string
  canonicalTrackId: string
  status: PlaybackAvailabilityStatus
  reason?: PlaybackAvailabilityReason
  checkedAt?: string
}

export type CanonicalPlaybackAvailability = {
  canonicalTrackId: string
  copies: SourceCopyAvailability[]
  playableCopies: SourceCopyAvailability[]
  hasPlayableCopy: boolean
}
