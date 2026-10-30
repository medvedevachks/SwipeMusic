/**
 * Логические музыкальные сессии (ARCH-PLAYBACK-01 / PLAYBACK-DEV-01+02).
 * Не путать с серверным auth session.
 */
import type { PlaybackContext } from '../../types/playbackContext.ts'
import type { RepeatMode, ShuffleMode } from '../playbackQueue/PlaybackQueue.ts'

export const PLAYBACK_SESSION_SCHEMA_VERSION = 2 as const

export const PLAYBACK_SESSION_IDS = [
  'swipes',
  'wave',
  'search',
  'catalog',
  'album',
] as const

export type PlaybackSessionId = (typeof PLAYBACK_SESSION_IDS)[number]

export type SessionPlaybackPhase =
  | 'idle'
  | 'ready'
  | 'playing'
  | 'user_paused'
  | 'network_interrupted'
  | 'user_gesture_required'
  | 'unavailable'

/**
 * Безопасный сериализуемый трек для снимков сессий.
 * Без previewUrl / stream URL / auth-токенов.
 */
export type SessionTrack = {
  id: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  album?: string
  genre?: string
  year?: number
  durationMs?: number
  /** Обложка после cover-URL policy (без credential query). */
  coverUrl?: string | null
  coverColor?: string
  tags?: string[]
}

/**
 * Сериализуемый снимок очереди слота.
 * Достаточен для полного restore в PlaybackQueue (DEV-03+), без setQueue-only.
 * pendingRemovalIds намеренно отсутствуют — runtime-only в текущей Queue.
 */
export type SessionQueueSnapshot = {
  items: SessionTrack[]
  currentIndex: number
  playOrder: number[]
  playOrderIndex: number
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  history: string[]
  historyIndex: number
  context: PlaybackContext
  /** Provenance insertNext / continuation tail. */
  sessionTailIds: string[]
  /** Позиция воспроизведения в секундах (не stream URL). */
  positionSeconds: number
  phase: SessionPlaybackPhase
  updatedAt: string
}

export type SwipesSessionMeta = { kind: 'swipes' }
export type WaveSessionMeta = { kind: 'wave' }
export type SearchSessionMeta = {
  kind: 'search'
  query: string | null
  seedTrackId: string | null
}
export type CatalogSessionMeta = {
  kind: 'catalog'
  /** null = пустой слот; иначе id каталога или виртуального списка (my-music / sys_swipes). */
  catalogId: string | null
  title: string | null
}
export type AlbumSessionMeta = {
  kind: 'album'
  albumId: string | null
  title: string | null
  artist?: string
  phase: 'album' | 'related'
}

export type SessionSlotMeta =
  | SwipesSessionMeta
  | WaveSessionMeta
  | SearchSessionMeta
  | CatalogSessionMeta
  | AlbumSessionMeta

export type PlaybackSessionSlot = {
  id: PlaybackSessionId
  meta: SessionSlotMeta
  queue: SessionQueueSnapshot
  /** Поколение содержимого слота; bump при replace. */
  slotGeneration: number
}

export type PlaybackSessionStoreSnapshot = {
  schemaVersion: typeof PLAYBACK_SESSION_SCHEMA_VERSION
  userId: string | null
  deviceId: string
  activeSessionId: PlaybackSessionId | null
  /**
   * Epoch логических переключений / Commit.
   * Не смешивать с playRequestId.
   */
  switchEpoch: number
  /**
   * Идентификатор последнего Play/Prepare-запроса.
   * Устаревший Prepare не должен Commit после более нового Play.
   */
  playRequestId: number
  slots: Record<PlaybackSessionId, PlaybackSessionSlot>
}

/** Токен Prepare (контракт для DEV-04; в store только поля). */
export type SessionSwitchToken = {
  switchEpoch: number
  playRequestId: number
  target: PlaybackSessionId
  targetSlotGeneration: number
  prepareId: string
}

/** Meta-документ persist v2 (отдельный ключ от слотов). */
export type PersistedSessionsMetaV2 = {
  schemaVersion: typeof PLAYBACK_SESSION_SCHEMA_VERSION
  userId: string
  deviceId: string
  activeSessionId: PlaybackSessionId | null
  switchEpoch: number
  playRequestId: number
  updatedAt: string
}

/** Один слот на диске. */
export type PersistedSessionSlotV2 = {
  schemaVersion: typeof PLAYBACK_SESSION_SCHEMA_VERSION
  userId: string
  deviceId: string
  slot: PlaybackSessionSlot
  updatedAt: string
}
