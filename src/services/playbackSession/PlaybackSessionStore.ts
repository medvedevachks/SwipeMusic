/**
 * In-memory PlaybackSessionStore (PLAYBACK-DEV-01/02).
 * Не связан с AudioPlayer / PlaybackQueue / Intent / CME.
 */
import { NONE_PLAYBACK_CONTEXT } from '../../types/playbackContext.ts'
import {
  cloneMeta,
  clonePlaybackSessionSlot,
  cloneSessionQueueSnapshot,
  isMetaCompatibleWithSession,
} from './clone.ts'
import { isValidDeviceId } from './deviceId.ts'
import {
  materializeLoadResult,
  type SessionsLoadResult,
} from './persistence.ts'
import { toSessionTrack } from './sanitizeTrack.ts'
import {
  PLAYBACK_SESSION_IDS,
  PLAYBACK_SESSION_SCHEMA_VERSION,
  type PlaybackSessionId,
  type PlaybackSessionSlot,
  type PlaybackSessionStoreSnapshot,
  type SessionQueueSnapshot,
  type SessionSlotMeta,
  type SessionTrack,
} from './types.ts'

export type PlaybackSessionStoreOptions = {
  userId?: string | null
  /** Обязателен: привязка экземпляра store к конкретному deviceId (R1). */
  deviceId: string
  now?: () => string
}

function emptyQueue(now: string): SessionQueueSnapshot {
  return {
    items: [],
    currentIndex: -1,
    playOrder: [],
    playOrderIndex: -1,
    repeatMode: 'OFF',
    shuffleMode: 'OFF',
    history: [],
    historyIndex: -1,
    context: NONE_PLAYBACK_CONTEXT,
    sessionTailIds: [],
    positionSeconds: 0,
    phase: 'idle',
    updatedAt: now,
  }
}

function defaultMeta(id: PlaybackSessionId): SessionSlotMeta {
  switch (id) {
    case 'swipes':
      return { kind: 'swipes' }
    case 'wave':
      return { kind: 'wave' }
    case 'search':
      return { kind: 'search', query: null, seedTrackId: null }
    case 'catalog':
      return { kind: 'catalog', catalogId: null, title: null }
    case 'album':
      return { kind: 'album', albumId: null, title: null, phase: 'album' }
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

function createEmptySlot(id: PlaybackSessionId, now: string): PlaybackSessionSlot {
  return {
    id,
    meta: defaultMeta(id),
    queue: emptyQueue(now),
    slotGeneration: 0,
  }
}

function createEmptySlots(now: string): Record<PlaybackSessionId, PlaybackSessionSlot> {
  const slots = {} as Record<PlaybackSessionId, PlaybackSessionSlot>
  for (const id of PLAYBACK_SESSION_IDS) {
    slots[id] = createEmptySlot(id, now)
  }
  return slots
}

export class MetaSessionMismatchError extends Error {
  readonly sessionId: PlaybackSessionId
  readonly metaKind: SessionSlotMeta['kind']

  constructor(sessionId: PlaybackSessionId, metaKind: SessionSlotMeta['kind']) {
    super(
      `Session meta kind "${metaKind}" is not compatible with session "${sessionId}"`,
    )
    this.name = 'MetaSessionMismatchError'
    this.sessionId = sessionId
    this.metaKind = metaKind
  }
}

export class InvalidDeviceIdError extends Error {
  constructor(deviceId: string) {
    super(`Invalid deviceId: ${deviceId}`)
    this.name = 'InvalidDeviceIdError'
  }
}

export class PlaybackSessionStore {
  private userId: string | null
  private deviceId: string
  private activeSessionId: PlaybackSessionId | null = null
  private switchEpoch = 0
  private playRequestId = 0
  private slots: Record<PlaybackSessionId, PlaybackSessionSlot>
  private readonly now: () => string

  constructor(options: PlaybackSessionStoreOptions) {
    if (!isValidDeviceId(options.deviceId)) {
      throw new InvalidDeviceIdError(options.deviceId)
    }
    this.now = options.now ?? (() => new Date().toISOString())
    this.userId = options.userId ?? null
    this.deviceId = options.deviceId
    this.slots = createEmptySlots(this.now())
  }

  getUserId(): string | null {
    return this.userId
  }

  getDeviceId(): string {
    return this.deviceId
  }

  getActiveSessionId(): PlaybackSessionId | null {
    return this.activeSessionId
  }

  getSwitchEpoch(): number {
    return this.switchEpoch
  }

  getPlayRequestId(): number {
    return this.playRequestId
  }

  getSlot(id: PlaybackSessionId): PlaybackSessionSlot {
    return clonePlaybackSessionSlot(this.slots[id]!)
  }

  getSnapshot(): PlaybackSessionStoreSnapshot {
    const slots = {} as Record<PlaybackSessionId, PlaybackSessionSlot>
    for (const id of PLAYBACK_SESSION_IDS) {
      slots[id] = clonePlaybackSessionSlot(this.slots[id]!)
    }
    return {
      schemaVersion: PLAYBACK_SESSION_SCHEMA_VERSION,
      userId: this.userId,
      deviceId: this.deviceId,
      activeSessionId: this.activeSessionId,
      switchEpoch: this.switchEpoch,
      playRequestId: this.playRequestId,
      slots,
    }
  }

  /**
   * Полная замена слота. meta.kind обязан совпадать с id.
   * bump slotGeneration.
   */
  replaceSlot(
    id: PlaybackSessionId,
    input: {
      meta: SessionSlotMeta
      queue: SessionQueueSnapshot
    },
  ): PlaybackSessionSlot {
    if (!isMetaCompatibleWithSession(id, input.meta)) {
      throw new MetaSessionMismatchError(id, input.meta.kind)
    }
    const prev = this.slots[id]!
    const next: PlaybackSessionSlot = {
      id,
      meta: cloneMeta(input.meta),
      queue: cloneSessionQueueSnapshot({
        ...input.queue,
        items: input.queue.items.map((item) => toSessionTrack(item)),
        updatedAt: input.queue.updatedAt || this.now(),
      }),
      slotGeneration: prev.slotGeneration + 1,
    }
    this.slots[id] = next
    return clonePlaybackSessionSlot(next)
  }

  /**
   * Обновить queue слота (история/порядок/позиция), meta без изменений.
   * По умолчанию bump slotGeneration (смена содержимого).
   *
   * R8 / DEV-04: для периодического сохранения только position/phase
   * передайте `{ bumpGeneration: false }`, чтобы не инвалидировать
   * незавершённый Prepare (token.targetSlotGeneration).
   */
  saveSlotQueue(
    id: PlaybackSessionId,
    queue: SessionQueueSnapshot,
    options?: { bumpGeneration?: boolean },
  ): PlaybackSessionSlot {
    const prev = this.slots[id]!
    const bump = options?.bumpGeneration !== false
    const next: PlaybackSessionSlot = {
      id,
      meta: cloneMeta(prev.meta),
      queue: cloneSessionQueueSnapshot({
        ...queue,
        items: queue.items.map((item) => toSessionTrack(item as SessionTrack)),
        updatedAt: queue.updatedAt || this.now(),
      }),
      slotGeneration: bump ? prev.slotGeneration + 1 : prev.slotGeneration,
    }
    this.slots[id] = next
    return clonePlaybackSessionSlot(next)
  }

  /**
   * Runtime-only обновление позиции/phase без bump slotGeneration (R8).
   */
  saveSlotRuntime(
    id: PlaybackSessionId,
    patch: {
      positionSeconds: number
      phase?: SessionQueueSnapshot['phase']
      updatedAt?: string
    },
  ): PlaybackSessionSlot {
    const prev = this.slots[id]!
    return this.saveSlotQueue(
      id,
      {
        ...cloneSessionQueueSnapshot(prev.queue),
        positionSeconds: patch.positionSeconds,
        phase: patch.phase ?? prev.queue.phase,
        updatedAt: patch.updatedAt || this.now(),
      },
      { bumpGeneration: false },
    )
  }

  setActiveSessionId(id: PlaybackSessionId | null): void {
    this.activeSessionId = id
  }

  bumpSwitchEpoch(): number {
    this.switchEpoch += 1
    return this.switchEpoch
  }

  beginPlayRequest(): number {
    this.playRequestId += 1
    return this.playRequestId
  }

  /**
   * Сброс всех слотов при logout / смене пользователя.
   */
  clearForLogout(): void {
    this.activeSessionId = null
    this.switchEpoch += 1
    this.playRequestId += 1
    this.userId = null
    this.slots = createEmptySlots(this.now())
  }

  rebindUser(userId: string | null): void {
    if (userId === this.userId) {
      return
    }
    this.clearForLogout()
    this.userId = userId
  }

  /**
   * R1: смена deviceId всегда очищает слоты. Старые данные другого
   * устройства не остаются в этом экземпляре store.
   */
  rebindDevice(deviceId: string): void {
    if (!isValidDeviceId(deviceId)) {
      throw new InvalidDeviceIdError(deviceId)
    }
    if (deviceId === this.deviceId) {
      return
    }
    this.activeSessionId = null
    this.switchEpoch += 1
    this.playRequestId += 1
    this.deviceId = deviceId
    this.slots = createEmptySlots(this.now())
  }

  /**
   * Hydrate из результата Persistence.load.
   * Не запускает аудио (audioAutoplay всегда false).
   * Требует совпадения userId/deviceId с текущим store.
   */
  hydrateFromLoadResult(load: SessionsLoadResult): { audioAutoplay: false } {
    if (load.userId !== this.userId) {
      throw new Error('hydrate userId mismatch')
    }
    if (load.deviceId !== this.deviceId) {
      throw new Error('hydrate deviceId mismatch')
    }
    const empty = createEmptySlots(this.now())
    const material = materializeLoadResult(load, empty)
    this.activeSessionId = material.activeSessionId
    this.switchEpoch = material.switchEpoch
    this.playRequestId = material.playRequestId
    this.slots = material.slots
    return { audioAutoplay: false }
  }
}

export function createPlaybackSessionStore(
  options: PlaybackSessionStoreOptions,
): PlaybackSessionStore {
  return new PlaybackSessionStore(options)
}

export function createEmptySessionQueueSnapshot(
  now = new Date().toISOString(),
): SessionQueueSnapshot {
  return emptyQueue(now)
}

export {
  clonePlaybackSessionSlot,
  cloneSessionQueueSnapshot,
  isMetaCompatibleWithSession,
} from './clone.ts'
