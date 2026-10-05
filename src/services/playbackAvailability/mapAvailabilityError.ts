import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
  type PlaybackAvailabilityReason,
  type PlaybackAvailabilityStatus,
  type TrackAvailabilityProbe,
} from '../../types/playbackAvailability.ts'

const AUTH_PATTERN = /unauth|not authenticated|auth required|требуется вход|login required/i
const DISCONNECTED_PATTERN = /disconnect|not connected|не подключ/i
const SUBSCRIPTION_PATTERN =
  /subscription|premium|plus|no[-_ ]?rights|нет прав|подписк/i
const MISSING_PATTERN = /not found|deleted|track missing|удал/i
const UNSUPPORTED_PATTERN = /not implemented|unsupported|не поддержи/i
const NETWORK_PATTERN =
  /timeout|timed out|network|failed to fetch|econnreset|enotfound|econnrefused|aborted/i

type ErrorFields = {
  statusCode?: number
  code?: string
  name?: string
  message: string
}

function readFields(error: unknown): ErrorFields {
  if (typeof error === 'string') {
    return { message: error }
  }
  if (!error || typeof error !== 'object') {
    return { message: '' }
  }
  const record = error as {
    status?: unknown
    code?: unknown
    name?: unknown
    message?: unknown
  }
  return {
    statusCode: typeof record.status === 'number' ? record.status : undefined,
    code: typeof record.code === 'string' ? record.code : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    message: typeof record.message === 'string' ? record.message : '',
  }
}

function probe(
  status: PlaybackAvailabilityStatus,
  reason: PlaybackAvailabilityReason,
): TrackAvailabilityProbe {
  return { status, reason }
}

/**
 * Сетевая ошибка остаётся UNKNOWN.
 * Доказанный отказ в правах не становится PLAYABLE.
 */
export function mapAvailabilityError(error: unknown): TrackAvailabilityProbe {
  const fields = readFields(error)
  const code = fields.code ?? ''
  const haystack = `${code} ${fields.message}`

  if (fields.statusCode === 401 || code === 'AUTH_REQUIRED' || AUTH_PATTERN.test(haystack)) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED,
      PLAYBACK_AVAILABILITY_REASON.AUTH_REQUIRED,
    )
  }
  if (code === 'NOT_CONNECTED' || DISCONNECTED_PATTERN.test(haystack)) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
      PLAYBACK_AVAILABILITY_REASON.NOT_CONNECTED,
    )
  }
  if (
    code === 'SUBSCRIPTION_REQUIRED' ||
    code === 'NO_RIGHTS' ||
    ((fields.statusCode === 403 || fields.statusCode === undefined) &&
      SUBSCRIPTION_PATTERN.test(haystack))
  ) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
      PLAYBACK_AVAILABILITY_REASON.SUBSCRIPTION_REQUIRED,
    )
  }
  if (fields.statusCode === 403) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      PLAYBACK_AVAILABILITY_REASON.PROVIDER_ERROR,
    )
  }
  if (
    fields.statusCode === 404 ||
    code === 'TRACK_MISSING' ||
    MISSING_PATTERN.test(haystack)
  ) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING,
    )
  }
  if (
    code === 'UNSUPPORTED' ||
    code === 'PLAYBACK_UNSUPPORTED' ||
    UNSUPPORTED_PATTERN.test(haystack)
  ) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
      PLAYBACK_AVAILABILITY_REASON.PLAYBACK_UNSUPPORTED,
    )
  }
  if (
    code === 'NETWORK' ||
    fields.name === 'TimeoutError' ||
    fields.name === 'AbortError' ||
    NETWORK_PATTERN.test(haystack)
  ) {
    return probe(
      PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
      PLAYBACK_AVAILABILITY_REASON.NETWORK,
    )
  }
  return probe(
    PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
    PLAYBACK_AVAILABILITY_REASON.PROVIDER_ERROR,
  )
}
