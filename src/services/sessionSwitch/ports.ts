/**
 * Порты SessionSwitchCoordinator (PLAYBACK-DEV-04 / 04A).
 * Реальные AudioPlayer / Intent подключаются в DEV-05; здесь — контракты.
 */
import type {
  PlaybackQueueSessionState,
  ImportSessionStateResult,
  PlaybackQueuePersistenceMode,
} from '../playbackQueue/PlaybackQueue.ts'
import type {
  PlaybackSessionId,
  SessionQueueSnapshot,
  SessionSlotMeta,
  SessionTrack,
} from '../playbackSession/types.ts'

/** Неразрушающая подготовка: без pause/stop текущего источника и без мутации live queue. */
export type TrackPrepareRequest = {
  track: SessionTrack
  playRequestId: number
  switchEpoch: number
}

export type PreparedTrackHandle = {
  trackId: string
  /** Opaque handle результата prepare (URL id и т.п. — без секретов в логах). */
  preparedRef: string
}

export type TrackPreparePort = {
  prepareTrack(request: TrackPrepareRequest): Promise<PreparedTrackHandle>
}

export type LiveRuntimeCapture = {
  state: PlaybackQueueSessionState
  pendingRemovalIds: string[]
}

export type LiveQueuePort = {
  exportSessionState(): PlaybackQueueSessionState
  /** Runtime snapshot including pending-removal ghosts (for rollback). */
  exportRuntimeSessionState(): LiveRuntimeCapture
  importSessionState(raw: unknown): ImportSessionStateResult
  importRuntimeSessionState(
    state: PlaybackQueueSessionState,
    pendingRemovalIds?: readonly string[],
  ): ImportSessionStateResult
  getPendingRemovalIds(): readonly string[]
  getPersistenceMode(): PlaybackQueuePersistenceMode
  detachLegacyPersistence(): void
  /** Discard in-memory queue without deleting legacy key. */
  clear?(): void
}

export type CommitPlayInput = {
  trackId: string
  preparedRef: string
  playRequestId: number
  /** generation на момент Prepare — устаревший Commit не должен глушить новый play. */
  playerGenerationAtPrepare: number
}

export type CommitPlayResult =
  | { ok: true; playerGeneration: number }
  | {
      ok: false
      reason: 'stale' | 'load_failed' | 'user_gesture_required' | 'error' | 'cancelled'
      message?: string
    }

export type RollbackPlayInput = {
  trackId: string | null
  positionSeconds: number
  playRequestId: number
  playerGenerationAtPrepare: number
  /**
   * Claim generation, выданный при входе в commitPlay этого же запроса
   * (если commit успел claim'нуть до failure).
   */
  commitClaimGeneration?: number
}

export type RollbackPlayResult =
  | { ok: true; restored: boolean }
  | {
      ok: false
      reason: 'stale' | 'user_gesture_required' | 'unavailable' | 'error' | 'cancelled'
      message?: string
    }

/**
 * Физический плеер. Commit/Rollback только после Validate.
 * Prepare НЕ вызывает эти методы.
 *
 * Контракт commitPlay (DEV-04A):
 * 1. Сразу claim: bump generation (commitClaimGeneration) ДО любого await.
 * 2. После каждого await: если getGeneration() !== commitClaimGeneration →
 *    `cancelled`, НЕ pause/stop и НЕ перезаписывать более новый playback.
 * 3. Координатор дополнительно проверяет playRequestId/switchEpoch после await.
 */
export type PhysicalPlayerPort = {
  getGeneration(): number
  getCurrentTrackId(): string | null
  getPositionSeconds(): number
  commitPlay(input: CommitPlayInput): Promise<CommitPlayResult>
  rollbackPlay(input: RollbackPlayInput): Promise<RollbackPlayResult>
}

/**
 * Best-effort persist. Нет транзакции на 5 ключей — координатор
 * не полагается на атомарность всего снимка.
 * writesLegacyV1 всегда false.
 */
export type SessionSwitchPersistPort = {
  readonly writesLegacyV1: false
  /** После успешного Commit — сохранить затронутые слоты/meta (best-effort). */
  persistAfterCommit?(input: {
    userId: string
    deviceId: string
    activeSessionId: PlaybackSessionId
    sourceSessionId: PlaybackSessionId | null
  }): void
}

export type SwitchPlayRequest = {
  target: PlaybackSessionId
  meta: SessionSlotMeta
  /** Полный снимок целевой очереди (уже durable SessionTrack). */
  targetQueue: SessionQueueSnapshot
  /** Трек, с которого начать (должен быть в targetQueue.items). */
  startTrackId: string
}

/** Runtime anchor для физического rollback (может быть pending ghost). */
export type RuntimePlaybackAnchor = {
  trackId: string | null
  positionSeconds: number
  isPendingRemoval: boolean
}
