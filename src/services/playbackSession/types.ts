/**
 * Логические музыкальные сессии (ARCH-PLAYBACK-01 / PLAYBACK-S1).
 * Не путать с серверным auth session.
 */
import type { PlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
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
 * Сериализуемый снимок очереди слота.
 * Достаточен для полного restore в PlaybackQueue (S2+), без setQueue-only.
 * pendingRemovalIds намеренно отсутствуют — runtime-only в текущей Queue.
 */
export type SessionQueueSnapshot = {
  items: Track[]
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
   * Идентитор последнего Play/Prepare-запроса.
   * Устаревший Prepare не должен Commit после более нового Play.
   */
  playRequestId: number
  slots: Record<PlaybackSessionId, PlaybackSessionSlot>
}

/** Токен Prepare (контракт для S4; в S1 только поля store). */
export type SessionSwitchToken = {
  switchEpoch: number
  playRequestId: number
  target: PlaybackSessionId
  targetSlotGeneration: number
  prepareId: string
}
