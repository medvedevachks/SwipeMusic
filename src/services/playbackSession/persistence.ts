/**
 * Persist v2 пяти музыкальных сессий (PLAYBACK-DEV-02).
 * Не связан с AudioPlayer / PlaybackQueue runtime / Intent / CME.
 */
import { clonePlaybackSessionSlot } from './clone.ts'
import type { StorageLike } from './deviceId.ts'
import { isValidDeviceId } from './deviceId.ts'
import {
  inspectLegacyPlaybackQueueV1,
  refuseLegacyV1Import,
  type LegacyV1Inspection,
} from './legacyV1.ts'
import {
  PLAYBACK_SESSION_IDS,
  PLAYBACK_SESSION_SCHEMA_VERSION,
  type PlaybackSessionId,
  type PlaybackSessionSlot,
  type PlaybackSessionStoreSnapshot,
  type PersistedSessionSlotV2,
  type PersistedSessionsMetaV2,
} from './types.ts'
import {
  assertSchemaVersion,
  validatePlaybackSessionSlot,
  type ValidationIssue,
} from './validate.ts'

export const SESSIONS_META_KEY_PREFIX = 'swipe-music-playback-sessions-v2/meta:'
export const SESSIONS_SLOT_KEY_PREFIX = 'swipe-music-playback-sessions-v2/slot:'

/** Лимит на один слот / meta: при превышении запись отклоняется, старые данные не трогаем. */
export const DEFAULT_MAX_BYTES_PER_KEY = 1_500_000

export type PersistenceWriteErrorCode =
  | 'quota'
  | 'size_limit'
  | 'unconfirmed_user'
  | 'device_mismatch'
  | 'invalid_device'
  | 'serialize'
  | 'storage'

export class PersistenceWriteError extends Error {
  readonly code: PersistenceWriteErrorCode
  readonly key?: string

  constructor(code: PersistenceWriteErrorCode, message: string, key?: string) {
    super(message)
    this.name = 'PersistenceWriteError'
    this.code = code
    this.key = key
  }
}

export type SlotLoadStatus =
  | { status: 'ok'; slot: PlaybackSessionSlot }
  | { status: 'missing' }
  | { status: 'corrupt'; issues: ValidationIssue[] }
  | { status: 'foreign'; reason: string }

export type SessionsLoadResult = {
  userId: string
  deviceId: string
  meta: PersistedSessionsMetaV2 | null
  metaCorrupt: boolean
  slots: Record<PlaybackSessionId, SlotLoadStatus>
  /**
   * Restore никогда не запускает аудио — только данные слотов.
   * Флаг для контрактных тестов / будущих wiring-гейтов.
   */
  audioAutoplay: false
  legacy: LegacyV1Inspection
}

export type PlaybackSessionPersistenceOptions = {
  storage: StorageLike
  maxBytesPerKey?: number
  now?: () => string
}

export function sessionsMetaStorageKey(userId: string, deviceId: string): string {
  return `${SESSIONS_META_KEY_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(deviceId)}`
}

export function sessionsSlotStorageKey(
  userId: string,
  deviceId: string,
  slotId: PlaybackSessionId,
): string {
  return `${SESSIONS_SLOT_KEY_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(deviceId)}:${slotId}`
}

function requireConfirmedUser(userId: string | null | undefined): string {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new PersistenceWriteError(
      'unconfirmed_user',
      'Persist v2 requires a confirmed non-empty userId',
    )
  }
  return userId
}

function requireDeviceId(deviceId: string): string {
  if (!isValidDeviceId(deviceId)) {
    throw new PersistenceWriteError('invalid_device', 'Invalid deviceId')
  }
  return deviceId
}

export class PlaybackSessionPersistence {
  private readonly storage: StorageLike
  private readonly maxBytesPerKey: number
  private readonly now: () => string

  constructor(options: PlaybackSessionPersistenceOptions) {
    this.storage = options.storage
    this.maxBytesPerKey = options.maxBytesPerKey ?? DEFAULT_MAX_BYTES_PER_KEY
    this.now = options.now ?? (() => new Date().toISOString())
  }

  inspectLegacyV1(): LegacyV1Inspection {
    return inspectLegacyPlaybackQueueV1(this.storage)
  }

  refuseLegacyImport(): ReturnType<typeof refuseLegacyV1Import> {
    return refuseLegacyV1Import(this.storage)
  }

  /**
   * Загрузка пяти слотов. Повреждённый слот → corrupt, остальные читаются.
   * Чужой userId в документе → foreign (не подставляем в store).
   * Аудио не запускается.
   */
  load(userId: string, deviceId: string): SessionsLoadResult {
    const confirmed = requireConfirmedUser(userId)
    const device = requireDeviceId(deviceId)
    const legacy = this.inspectLegacyV1()
    // Явно не импортируем legacy
    void this.refuseLegacyImport()

    const slots = {} as Record<PlaybackSessionId, SlotLoadStatus>
    for (const id of PLAYBACK_SESSION_IDS) {
      slots[id] = this.loadSlot(confirmed, device, id)
    }

    const metaKey = sessionsMetaStorageKey(confirmed, device)
    let meta: PersistedSessionsMetaV2 | null = null
    let metaCorrupt = false
    try {
      const raw = this.storage.getItem(metaKey)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        const validated = this.validateMetaDocument(parsed, confirmed, device)
        if (validated.ok) {
          meta = validated.value
        } else {
          metaCorrupt = true
        }
      }
    } catch {
      metaCorrupt = true
    }

    return {
      userId: confirmed,
      deviceId: device,
      meta,
      metaCorrupt,
      slots,
      audioAutoplay: false,
      legacy,
    }
  }

  saveSlot(
    userId: string,
    deviceId: string,
    slot: PlaybackSessionSlot,
  ): void {
    const confirmed = requireConfirmedUser(userId)
    const device = requireDeviceId(deviceId)
    if (slot.id && slot.meta.kind !== slot.id) {
      throw new PersistenceWriteError(
        'serialize',
        `meta.kind ${slot.meta.kind} incompatible with slot ${slot.id}`,
      )
    }
    const validated = validatePlaybackSessionSlot(slot, slot.id)
    if (!validated.ok) {
      throw new PersistenceWriteError(
        'serialize',
        `Invalid slot: ${validated.issues.map((i) => i.message).join('; ')}`,
      )
    }
    const payload: PersistedSessionSlotV2 = {
      schemaVersion: PLAYBACK_SESSION_SCHEMA_VERSION,
      userId: confirmed,
      deviceId: device,
      slot: clonePlaybackSessionSlot(validated.value),
      updatedAt: this.now(),
    }
    const key = sessionsSlotStorageKey(confirmed, device, slot.id)
    this.writeJsonAtomic(key, payload)
  }

  saveMeta(
    userId: string,
    deviceId: string,
    meta: Omit<PersistedSessionsMetaV2, 'schemaVersion' | 'userId' | 'deviceId' | 'updatedAt'> & {
      updatedAt?: string
    },
  ): void {
    const confirmed = requireConfirmedUser(userId)
    const device = requireDeviceId(deviceId)
    const payload: PersistedSessionsMetaV2 = {
      schemaVersion: PLAYBACK_SESSION_SCHEMA_VERSION,
      userId: confirmed,
      deviceId: device,
      activeSessionId: meta.activeSessionId,
      switchEpoch: meta.switchEpoch,
      playRequestId: meta.playRequestId,
      updatedAt: meta.updatedAt ?? this.now(),
    }
    const key = sessionsMetaStorageKey(confirmed, device)
    this.writeJsonAtomic(key, payload)
  }

  /**
   * Сохраняет meta + все слоты из snapshot.
   * При ошибке на одном ключе предыдущие успешные записи остаются
   * (слоты независимы); вызывающий может ретраить.
   * Неудачная запись конкретного ключа не затирает старое значение этого ключа.
   */
  saveSnapshot(snapshot: PlaybackSessionStoreSnapshot): void {
    const confirmed = requireConfirmedUser(snapshot.userId)
    requireDeviceId(snapshot.deviceId)
    if (snapshot.schemaVersion !== PLAYBACK_SESSION_SCHEMA_VERSION) {
      throw new PersistenceWriteError('serialize', 'Unsupported schemaVersion')
    }
    for (const id of PLAYBACK_SESSION_IDS) {
      this.saveSlot(confirmed, snapshot.deviceId, snapshot.slots[id]!)
    }
    this.saveMeta(confirmed, snapshot.deviceId, {
      activeSessionId: snapshot.activeSessionId,
      switchEpoch: snapshot.switchEpoch,
      playRequestId: snapshot.playRequestId,
    })
  }

  /**
   * Очистка локальных ключей текущего user+device (logout).
   * Legacy v1 не трогаем.
   */
  clearUserDevice(userId: string, deviceId: string): void {
    const confirmed = requireConfirmedUser(userId)
    const device = requireDeviceId(deviceId)
    this.storage.removeItem(sessionsMetaStorageKey(confirmed, device))
    for (const id of PLAYBACK_SESSION_IDS) {
      this.storage.removeItem(sessionsSlotStorageKey(confirmed, device, id))
    }
  }

  private loadSlot(
    userId: string,
    deviceId: string,
    slotId: PlaybackSessionId,
  ): SlotLoadStatus {
    const key = sessionsSlotStorageKey(userId, deviceId, slotId)
    let raw: string | null
    try {
      raw = this.storage.getItem(key)
    } catch {
      return { status: 'corrupt', issues: [{ path: key, message: 'storage_read_failed' }] }
    }
    if (raw == null) {
      return { status: 'missing' }
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') {
        return {
          status: 'corrupt',
          issues: [{ path: key, message: 'expected object' }],
        }
      }
      const doc = parsed as Record<string, unknown>
      const schemaIssue = assertSchemaVersion(doc.schemaVersion, 'schemaVersion')
      if (schemaIssue) {
        return { status: 'corrupt', issues: [schemaIssue] }
      }
      if (doc.userId !== userId) {
        return {
          status: 'foreign',
          reason: 'persisted userId does not match load userId',
        }
      }
      if (doc.deviceId !== deviceId) {
        return {
          status: 'foreign',
          reason: 'persisted deviceId does not match load deviceId',
        }
      }
      const slotResult = validatePlaybackSessionSlot(doc.slot, slotId, 'slot')
      if (!slotResult.ok) {
        return { status: 'corrupt', issues: slotResult.issues }
      }
      return { status: 'ok', slot: slotResult.value }
    } catch {
      return {
        status: 'corrupt',
        issues: [{ path: key, message: 'invalid_json' }],
      }
    }
  }

  private validateMetaDocument(
    value: unknown,
    userId: string,
    deviceId: string,
  ): { ok: true; value: PersistedSessionsMetaV2 } | { ok: false } {
    if (!value || typeof value !== 'object') {
      return { ok: false }
    }
    const raw = value as Record<string, unknown>
    if (assertSchemaVersion(raw.schemaVersion)) {
      return { ok: false }
    }
    if (raw.userId !== userId || raw.deviceId !== deviceId) {
      return { ok: false }
    }
    if (
      typeof raw.switchEpoch !== 'number' ||
      !Number.isInteger(raw.switchEpoch) ||
      raw.switchEpoch < 0
    ) {
      return { ok: false }
    }
    if (
      typeof raw.playRequestId !== 'number' ||
      !Number.isInteger(raw.playRequestId) ||
      raw.playRequestId < 0
    ) {
      return { ok: false }
    }
    const active = raw.activeSessionId
    if (
      active !== null &&
      !(PLAYBACK_SESSION_IDS as readonly string[]).includes(active as string)
    ) {
      return { ok: false }
    }
    if (typeof raw.updatedAt !== 'string') {
      return { ok: false }
    }
    return {
      ok: true,
      value: {
        schemaVersion: PLAYBACK_SESSION_SCHEMA_VERSION,
        userId,
        deviceId,
        activeSessionId: active as PersistedSessionsMetaV2['activeSessionId'],
        switchEpoch: raw.switchEpoch,
        playRequestId: raw.playRequestId,
        updatedAt: raw.updatedAt,
      },
    }
  }

  /**
   * Запись с проверкой размера. При quota/ошибке старое значение ключа
   * не удаляется заранее — setItem либо заменяет атомарно, либо бросает.
   */
  private writeJsonAtomic(key: string, value: unknown): void {
    let serialized: string
    try {
      serialized = JSON.stringify(value)
    } catch (err) {
      throw new PersistenceWriteError(
        'serialize',
        err instanceof Error ? err.message : 'serialize failed',
        key,
      )
    }
    // UTF-16-ish estimate for JS strings in localStorage
    const bytes = serialized.length * 2
    if (bytes > this.maxBytesPerKey) {
      throw new PersistenceWriteError(
        'size_limit',
        `Payload exceeds maxBytesPerKey (${this.maxBytesPerKey}); refusing write to preserve queue/history integrity`,
        key,
      )
    }
    try {
      this.storage.setItem(key, serialized)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const quota =
        (typeof DOMException !== 'undefined' &&
          err instanceof DOMException &&
          (err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) ||
        /quota/i.test(message)
      throw new PersistenceWriteError(
        quota ? 'quota' : 'storage',
        message || 'storage write failed',
        key,
      )
    }
  }
}

export function createPlaybackSessionPersistence(
  options: PlaybackSessionPersistenceOptions,
): PlaybackSessionPersistence {
  return new PlaybackSessionPersistence(options)
}

/**
 * Применяет успешные слоты/meta к пустому снимку-результату для hydrate store.
 * Не вызывает play.
 */
export function materializeLoadResult(
  load: SessionsLoadResult,
  emptySlots: Record<PlaybackSessionId, PlaybackSessionSlot>,
): {
  userId: string
  deviceId: string
  activeSessionId: PlaybackSessionId | null
  switchEpoch: number
  playRequestId: number
  slots: Record<PlaybackSessionId, PlaybackSessionSlot>
  audioAutoplay: false
} {
  const slots = { ...emptySlots }
  for (const id of PLAYBACK_SESSION_IDS) {
    const status = load.slots[id]
    if (status.status === 'ok') {
      slots[id] = clonePlaybackSessionSlot(status.slot)
    }
  }
  return {
    userId: load.userId,
    deviceId: load.deviceId,
    activeSessionId: load.meta?.activeSessionId ?? null,
    switchEpoch: load.meta?.switchEpoch ?? 0,
    playRequestId: load.meta?.playRequestId ?? 0,
    slots,
    audioAutoplay: false,
  }
}
