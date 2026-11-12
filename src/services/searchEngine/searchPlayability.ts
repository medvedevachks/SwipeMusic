import type {
  CanonicalPlaybackAvailability,
  PlaybackAvailabilityStatus,
  SourceCopyAvailability,
} from '../../types/playbackAvailability.ts'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../types/playbackAvailability.ts'
import type { Track } from '../../types/track.ts'

export type SearchTrackPlayability = 'playable' | 'unavailable' | 'unknown'

export type ProviderWarningEntry = {
  sourceId: string
  message: string
}

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

let indexedByCanonicalId: Record<string, CanonicalPlaybackAvailability> | null =
  null
let sourceTrackKeyIndex: ReadonlyMap<string, SourceCopyAvailability> = new Map()

/**
 * Индекс копий по sourceTrackKey.
 * Пересчитывается только когда меняется ссылка byCanonicalId (replace/clear store).
 */
export function getPlaybackAvailabilitySourceIndex(
  byCanonicalId: Record<string, CanonicalPlaybackAvailability>,
): ReadonlyMap<string, SourceCopyAvailability> {
  if (byCanonicalId === indexedByCanonicalId) {
    return sourceTrackKeyIndex
  }
  const next = new Map<string, SourceCopyAvailability>()
  for (const entry of Object.values(byCanonicalId)) {
    for (const copy of entry.copies) {
      if (!copy.sourceTrackKey) {
        continue
      }
      next.set(copy.sourceTrackKey, copy)
    }
  }
  indexedByCanonicalId = byCanonicalId
  sourceTrackKeyIndex = next
  return sourceTrackKeyIndex
}

/** Только для unit-тестов индекса. */
export function resetPlaybackAvailabilitySourceIndexForTests(): void {
  indexedByCanonicalId = null
  sourceTrackKeyIndex = new Map()
}

export function lookupSearchTrackAvailability(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
  index: ReadonlyMap<string, SourceCopyAvailability>,
): SourceCopyAvailability | null {
  for (const key of searchTrackSourceKeys(track)) {
    const hit = index.get(key)
    if (hit) {
      return hit
    }
  }
  return null
}

/**
 * Ищет уже известный результат PlaybackAvailability для трека поиска.
 * Не запускает probe и не читает provider `available`.
 */
export function findPlaybackAvailabilityForSearchTrack(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
  byCanonicalId: Record<string, CanonicalPlaybackAvailability>,
): SourceCopyAvailability | null {
  return lookupSearchTrackAvailability(
    track,
    getPlaybackAvailabilitySourceIndex(byCanonicalId),
  )
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

export function resolveSearchTrackPlayabilityFromIndex(
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
  index: ReadonlyMap<string, SourceCopyAvailability>,
): SearchTrackPlayability {
  return resolveSearchTrackPlayabilityFromAvailability(
    lookupSearchTrackAvailability(track, index),
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

/**
 * После успешного ответа источника его warning снимается;
 * ошибки других источников сохраняются; новые ошибки перезаписывают запись источника.
 */
export function reconcileProviderWarningsBySource(
  existing: Record<string, string>,
  update: {
    recoveredSourceIds: readonly string[]
    errors: readonly ProviderWarningEntry[]
  },
): Record<string, string> {
  const next = { ...existing }
  for (const sourceId of update.recoveredSourceIds) {
    delete next[sourceId]
  }
  for (const error of update.errors) {
    const message = error.message.trim()
    if (!error.sourceId || !message) {
      continue
    }
    next[error.sourceId] = message
  }
  return next
}

export function providerWarningsList(
  bySource: Record<string, string>,
): string[] {
  return Object.keys(bySource)
    .sort()
    .map((sourceId) => bySource[sourceId]!)
}
