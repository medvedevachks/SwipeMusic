import { PLAYBACK_QUEUE_STORAGE_KEY } from '../playbackQueue/PlaybackQueue.ts'
import type { StorageLike } from './deviceId.ts'

/**
 * Политика legacy `swipe-music-playback-queue-v1` (PLAYBACK-DEV-02).
 *
 * Факт: v1 не содержит достоверного userId.
 * Поэтому нельзя автоматически импортировать содержимое в сессию
 * подтверждённого пользователя — это раскрыло бы чужую (или анонимную)
 * очередь другому аккаунту на том же устройстве.
 *
 * Решение:
 * - НЕ импортировать в PlaybackSessionStore / persist v2 автоматически;
 * - НЕ удалять legacy-ключ без отдельного архитектурного решения;
 * - оставить данные на месте; предоставить inspect для UI/будущей миграции
 *   с явным подтверждением владельца.
 *
 * sessionTailIds / pendingRemovalIds в v1 учитываются только если/когда
 * будет отдельное DEV-решение с proof of ownership (сейчас не читаем в store).
 */

export type LegacyV1Inspection = {
  key: typeof PLAYBACK_QUEUE_STORAGE_KEY
  present: boolean
  /** Размер raw JSON в символах; 0 если нет. */
  rawLength: number
  /** Всегда false: автоимпорт запрещён без proof of ownership. */
  eligibleForAutoImport: false
  reason: string
  /** Наблюдаемые поля верхнего уровня (без раскрытия items). */
  observedTopLevelKeys: string[]
  hasSessionTailIdsField: boolean
  hasPendingRemovalIdsField: boolean
}

export function inspectLegacyPlaybackQueueV1(
  storage: StorageLike,
): LegacyV1Inspection {
  const raw = storage.getItem(PLAYBACK_QUEUE_STORAGE_KEY)
  if (raw == null) {
    return {
      key: PLAYBACK_QUEUE_STORAGE_KEY,
      present: false,
      rawLength: 0,
      eligibleForAutoImport: false,
      reason: 'legacy_key_absent',
      observedTopLevelKeys: [],
      hasSessionTailIdsField: false,
      hasPendingRemovalIdsField: false,
    }
  }

  let observedTopLevelKeys: string[] = []
  let hasSessionTailIdsField = false
  let hasPendingRemovalIdsField = false
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      observedTopLevelKeys = Object.keys(parsed as object)
      hasSessionTailIdsField = Object.prototype.hasOwnProperty.call(
        parsed,
        'sessionTailIds',
      )
      hasPendingRemovalIdsField = Object.prototype.hasOwnProperty.call(
        parsed,
        'pendingRemovalIds',
      )
    }
  } catch {
    observedTopLevelKeys = []
  }

  return {
    key: PLAYBACK_QUEUE_STORAGE_KEY,
    present: true,
    rawLength: raw.length,
    eligibleForAutoImport: false,
    reason:
      'legacy_v1_has_no_trusted_userId; keep in place; do not import into confirmed account session',
    observedTopLevelKeys,
    hasSessionTailIdsField,
    hasPendingRemovalIdsField,
  }
}

/**
 * Явный отказ от импорта: всегда null + inspection.
 * Не читать items в SessionStore.
 */
export function refuseLegacyV1Import(storage: StorageLike): {
  imported: false
  inspection: LegacyV1Inspection
} {
  return {
    imported: false,
    inspection: inspectLegacyPlaybackQueueV1(storage),
  }
}
