import type {
  CanonicalPlaybackAvailability,
  PlaybackAvailabilityStatus,
  SourceCopyAvailability,
} from '../../types/playbackAvailability.ts'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../types/playbackAvailability.ts'
import type { Track } from '../../types/track.ts'

export type SearchTrackPlayability = 'playable' | 'unavailable' | 'unknown'

const CONFIRMED_UNAVAILABLE: ReadonlySet<PlaybackAvailabilityStatus> = new Set([
  PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
  PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED,
  PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
  PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
  PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
])

/** Ключи SourceCopy, которыми PlaybackAvailability идентифицирует копию. */
export function searchTrackSourceKeys(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
): string[] {
  const keys = [track.id]
  const composed = `${track.sourceId}:${track.externalId}`
  if (composed !== track.id) {
    keys.push(composed)
  }
  return keys
}

/**
 * Ищет уже известный результат PlaybackAvailability для трека поиска.
 * Не запускает probe и не читает provider `available`.
 */
export function findPlaybackAvailabilityForSearchTrack(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
  byCanonicalId: Record<string, CanonicalPlaybackAvailability>,
): SourceCopyAvailability | null {
  const keys = new Set(searchTrackSourceKeys(track))
  for (const entry of Object.values(byCanonicalId)) {
    for (const copy of entry.copies) {
      if (keys.has(copy.sourceTrackKey)) {
        return copy
      }
    }
  }
  return null
}

/**
 * Достоверный статус только из PlaybackAvailability.
 * UNKNOWN / отсутствие записи → unknown (индикатор скрыт).
 */
export function resolveSearchTrackPlayabilityFromAvailability(
  copy: Pick<SourceCopyAvailability, 'status'> | null | undefined,
): SearchTrackPlayability {
  if (!copy) {
    return 'unknown'
  }
  if (copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE) {
    return 'playable'
  }
  if (CONFIRMED_UNAVAILABLE.has(copy.status)) {
    return 'unavailable'
  }
  return 'unknown'
}

export function resolveSearchTrackPlayability(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
  byCanonicalId: Record<string, CanonicalPlaybackAvailability>,
): SearchTrackPlayability {
  return resolveSearchTrackPlayabilityFromAvailability(
    findPlaybackAvailabilityForSearchTrack(track, byCanonicalId),
  )
}

export function searchPlayabilityLabel(
  status: SearchTrackPlayability,
): string | null {
  if (status === 'playable') {
    return 'Доступно'
  }
  if (status === 'unavailable') {
    return 'Недоступно'
  }
  return null
}

export function mergeProviderWarnings(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of [...existing, ...incoming]) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}
