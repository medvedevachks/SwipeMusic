import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
  type TrackAvailabilityProbe,
} from '../../../types/playbackAvailability.ts'
import { mapAvailabilityError } from '../../../services/playbackAvailability/mapAvailabilityError.ts'
import type { YandexTrack } from './types.ts'

/**
 * Оценка по метаданным /tracks (без download-info и без stream URL).
 * Подключённость сама по себе не делает композицию PLAYABLE.
 */
export function assessYandexTrackRow(
  row: YandexTrack | null | undefined,
  options: { hasPlus: boolean },
): TrackAvailabilityProbe {
  if (!row || row.id == null || String(row.id).length === 0) {
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      reason: PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING,
    }
  }

  const hasPlus = options.hasPlus
  const premiumOnly =
    row.availableForPremiumUsers === true &&
    row.availableFullWithoutPermission !== true
  const explicitlyAvailable = row.available === true
  const freeFull = row.availableFullWithoutPermission === true
  const explicitlyUnavailable = row.available === false

  if (explicitlyUnavailable) {
    if (premiumOnly && !hasPlus) {
      return {
        status: PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
        reason: PLAYBACK_AVAILABILITY_REASON.SUBSCRIPTION_REQUIRED,
      }
    }
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      reason: PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING,
    }
  }

  if (premiumOnly && !hasPlus && !explicitlyAvailable && !freeFull) {
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED,
      reason: PLAYBACK_AVAILABILITY_REASON.SUBSCRIPTION_REQUIRED,
    }
  }

  if (explicitlyAvailable || freeFull || (premiumOnly && hasPlus)) {
    return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
  }

  // Метаданные есть, но флаг available не подтверждён — не угадываем PLAYABLE.
  return {
    status: PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
    reason: PLAYBACK_AVAILABILITY_REASON.NOT_CHECKED,
  }
}

export type YandexAvailabilityDeps = {
  isAvailable: boolean
  hasPlus: boolean
  externalId: string
  getTracksByIds: (ids: string) => Promise<YandexTrack[]>
}

/**
 * Контракт availability Яндекса для каталога / prepareCanonicalPlayback.
 * Не вызывает getDownloadInfo / resolveDirectStreamUrl / getPlaybackCandidates.
 */
export async function probeYandexTrackAvailability(
  deps: YandexAvailabilityDeps,
): Promise<TrackAvailabilityProbe> {
  if (!deps.isAvailable) {
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED,
      reason: PLAYBACK_AVAILABILITY_REASON.AUTH_REQUIRED,
    }
  }

  try {
    const rows = await deps.getTracksByIds(deps.externalId)
    // Только точное совпадение id: чужой rows[0] не подтверждает доступность.
    const row = rows.find(
      (item) => String(item.id) === String(deps.externalId),
    )
    return assessYandexTrackRow(row, { hasPlus: deps.hasPlus })
  } catch (error) {
    return mapAvailabilityError(error)
  }
}
