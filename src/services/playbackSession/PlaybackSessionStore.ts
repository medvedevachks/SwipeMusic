/**
 * In-memory PlaybackSessionStore (PLAYBACK-S1).
 * Не связан с AudioPlayer / PlaybackQueue / Intent / CME.
 */
import { NONE_PLAYBACK_CONTEXT } from '../../types/playbackContext.ts'
import { sanitizeSessionTrack, sanitizeSessionTracks } from './sanitizeTrack.ts'
import {
  PLAYBACK_SESSION_IDS,
  PLAYBACK_SESSION_SCHEMA_VERSION,
  type PlaybackSessionId,
  type PlaybackSessionSlot,
  type PlaybackSessionStoreSnapshot,
  type SessionQueueSnapshot,
  type SessionSlotMeta,
} from './types.ts'

export type PlaybackSessionStoreOptions = {
  userId?: string | null
  deviceId?: string
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

export function isMetaCompatibleWithSession(
  sessionId: PlaybackSessionId,
  meta: SessionSlotMeta,
): boolean {
  return meta.kind === sessionId
}

function cloneMeta(meta: SessionSlotMeta): SessionSlotMeta {
  switch (meta.kind) {
    case 'swipes':
      return { kind: 'swipes' }
    case 'wave':
      return { kind: 'wave' }
    case 'search':
      return {
        kind: 'search',
        query: meta.query,
        seedTrackId: meta.seedTrackId,
      }
    case 'catalog':
      return {
        kind: 'catalog',
        catalogId: meta.catalogId,
        title: meta.title,
      }
    case 'album':
      return {
        kind: 'album',
        albumId: meta.albumId,
        title: meta.title,
        ...(meta.artist !== undefined ? { artist: meta.artist } : {}),
        phase: meta.phase,
      }
    default: {
      const _exhaustive: never = meta
      return _exhaustive
    }
  }
}

function cloneContext(
  context: SessionQueueSnapshot['context'],
): SessionQueueSnapshot['context'] {
  if (context.type === 'search-seed') {
    return {
      type: 'search-seed',
      query: context.query,
      seedTrackId: context.seedTrackId,
      ...(context.hardExcludeHits
        ? {
            hardExcludeHits: context.hardExcludeHits.map((hit) => ({ ...hit })),
          }
        : {}),
    }
  }
  if (context.type === 'album') {
    return {
      type: 'album',
      id: context.id,
      title: context.title,
      ...(context.artist !== undefined ? { artist: context.artist } : {}),
    }
  }
  if (context.type === 'playlist') {
    return { type: 'playlist', id: context.id, title: context.title }
  }
  if (context.type === 'search') {
    return { type: 'search', query: context.query }
  }
  if (context.type === 'radio') {
    return {
      type: 'radio',
      id: context.id,
      title: context.title,
      origin: context.origin,
    }
  }
  if (context.type === 'library') {
    return { type: 'library' }
  }
  if (context.type === 'swipe') {
    return { type: 'swipe' }
  }
  return { type: 'none' }
}

export function cloneSessionQueueSnapshot(
  queue: SessionQueueSnapshot,
): SessionQueueSnapshot {
  return {
    items: sanitizeSessionTracks(queue.items),
    currentIndex: queue.currentIndex,
    playOrder: [...queue.playOrder],
    playOrderIndex: queue.playOrderIndex,
    repeatMode: queue.repeatMode,
    shuffleMode: queue.shuffleMode,
    history: [...queue.history],
    historyIndex: queue.historyIndex,
    context: cloneContext(queue.context),
    sessionTailIds: [...queue.sessionTailIds],
    positionSeconds: queue.positionSeconds,
    phase: queue.phase,
    updatedAt: queue.updatedAt,
  }
}

export function clonePlaybackSessionSlot(slot: PlaybackSessionSlot): PlaybackSessionSlot {
  return {
    id: slot.id,
    meta: cloneMeta(slot.meta),
    queue: cloneSessionQueueSnapshot(slot.queue),
    slotGeneration: slot.slotGeneration,
  }
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

export class PlaybackSessionStore {
  private userId: string | null
  private deviceId: string
  private activeSessionId: PlaybackSessionId | null = null
  private switchEpoch = 0
  private playRequestId = 0
  private slots: Record<PlaybackSessionId, PlaybackSessionSlot>
  private readonly now: () => string

  constructor(options: PlaybackSessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.userId = options.userId ?? null
    this.deviceId = options.deviceId ?? 'device-unknown'
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
        items: input.queue.items.map(sanitizeSessionTrack),
        updatedAt: input.queue.updatedAt || this.now(),
      }),
      slotGeneration: prev.slotGeneration + 1,
    }
    this.slots[id] = next
    return clonePlaybackSessionSlot(next)
  }

  /**
   * Обновить только queue слота (история/порядок/позиция), meta без изменений.
   * bump slotGeneration.
   */
  saveSlotQueue(
    id: PlaybackSessionId,
    queue: SessionQueueSnapshot,
  ): PlaybackSessionSlot {
    const prev = this.slots[id]!
    const next: PlaybackSessionSlot = {
      id,
      meta: cloneMeta(prev.meta),
      queue: cloneSessionQueueSnapshot({
        ...queue,
        items: queue.items.map(sanitizeSessionTrack),
        updatedAt: queue.updatedAt || this.now(),
      }),
      slotGeneration: prev.slotGeneration + 1,
    }
    this.slots[id] = next
    return clonePlaybackSessionSlot(next)
  }

  setActiveSessionId(id: PlaybackSessionId | null): void {
    this.activeSessionId = id
  }

  /** Epoch Commit / переключения сессий. */
  bumpSwitchEpoch(): number {
    this.switchEpoch += 1
    return this.switchEpoch
  }

  /** Новый Play/Prepare-запрос (отдельно от switchEpoch). */
  beginPlayRequest(): number {
    this.playRequestId += 1
    return this.playRequestId
  }

  /**
   * Сброс всех слотов при logout / смене пользователя.
   * Изоляция: чужой userId не должен видеть предыдущие слоты.
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

  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId
  }
}

export function createPlaybackSessionStore(
  options?: PlaybackSessionStoreOptions,
): PlaybackSessionStore {
  return new PlaybackSessionStore(options)
}

export function createEmptySessionQueueSnapshot(
  now = new Date().toISOString(),
): SessionQueueSnapshot {
  return emptyQueue(now)
}
