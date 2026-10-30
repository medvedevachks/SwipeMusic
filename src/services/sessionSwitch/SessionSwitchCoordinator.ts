/**
 * Координатор Prepare → Validate → Commit → Finalize/Rollback (PLAYBACK-DEV-04).
 * Не подключён к PlaybackIntent / production AudioPlayer (DEV-05).
 */
import type { PlaybackSessionStore } from '../playbackSession/PlaybackSessionStore.ts'
import { isMetaCompatibleWithSession } from '../playbackSession/clone.ts'
import type {
  PlaybackSessionId,
  SessionPlaybackPhase,
  SessionQueueSnapshot,
  SessionSwitchToken,
} from '../playbackSession/types.ts'
import {
  playbackExportToSessionQueue,
  sessionQueueToPlaybackQueueState,
} from './queueSnapshotBridge.ts'
import type {
  LiveQueuePort,
  PhysicalPlayerPort,
  PreparedTrackHandle,
  SessionSwitchPersistPort,
  SwitchPlayRequest,
  TrackPreparePort,
} from './ports.ts'

export type CoordinatorPhase =
  | 'idle'
  | 'preparing'
  | 'validating'
  | 'committing'
  | 'finalizing'
  | 'rolling_back'

export type SwitchResult =
  | {
      ok: true
      activeSessionId: PlaybackSessionId
      playRequestId: number
      switchEpoch: number
      playerGeneration: number
    }
  | {
      ok: false
      reason:
        | 'prepare_failed'
        | 'validate_failed'
        | 'stale'
        | 'commit_failed'
        | 'rollback_partial'
        | 'user_gesture_required'
        | 'logged_out'
        | 'invalid_request'
      playRequestId: number
      message?: string
      /** Логическая сессия после операции (может быть прежняя). */
      activeSessionId: PlaybackSessionId | null
      phase?: SessionPlaybackPhase
    }

type PendingSwitch = {
  token: SessionSwitchToken
  request: SwitchPlayRequest
  prepared: PreparedTrackHandle
  playerGenerationAtPrepare: number
  sourceSessionId: PlaybackSessionId | null
  /** Снимок источника на Prepare — НЕ использовать для финальной позиции. */
  sourceHintAtPrepare: SessionQueueSnapshot | null
}

export type SessionSwitchCoordinatorOptions = {
  store: PlaybackSessionStore
  queue: LiveQueuePort
  player: PhysicalPlayerPort
  prepare: TrackPreparePort
  persist?: SessionSwitchPersistPort
  now?: () => string
  createPrepareId?: () => string
}

function createPrepareId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `prep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class SessionSwitchCoordinator {
  private readonly store: PlaybackSessionStore
  private readonly queue: LiveQueuePort
  private readonly player: PhysicalPlayerPort
  private readonly preparePort: TrackPreparePort
  private readonly persist: SessionSwitchPersistPort
  private readonly now: () => string
  private readonly createPrepareId: () => string

  private phase: CoordinatorPhase = 'idle'
  private pending: PendingSwitch | null = null
  /** UI navigation never triggers music switch — explicit no-op surface for tests. */
  private uiNavigationCount = 0

  constructor(options: SessionSwitchCoordinatorOptions) {
    this.store = options.store
    this.queue = options.queue
    this.player = options.player
    this.preparePort = options.prepare
    this.persist = options.persist ?? { writesLegacyV1: false }
    this.now = options.now ?? (() => new Date().toISOString())
    this.createPrepareId = options.createPrepareId ?? createPrepareId
  }

  getPhase(): CoordinatorPhase {
    return this.phase
  }

  getUiNavigationCount(): number {
    return this.uiNavigationCount
  }

  /**
   * Навигация UI не инициирует переключение музыки.
   * Контракт для DEV-05: роутер/BottomNav зовут это, а не switchTo.
   */
  onUiNavigation(_path?: string): void {
    this.uiNavigationCount += 1
    // намеренно пусто — нет switchTo / prepare / pause
  }

  /**
   * Инвалидация незавершённых операций при logout / смене пользователя.
   * Store.rebindUser / clearForLogout уже bump playRequestId.
   */
  invalidatePending(reason: 'logout' | 'user_rebind' = 'logout'): void {
    this.pending = null
    this.phase = 'idle'
    void reason
  }

  async switchTo(request: SwitchPlayRequest): Promise<SwitchResult> {
    if (!isMetaCompatibleWithSession(request.target, request.meta)) {
      return {
        ok: false,
        reason: 'invalid_request',
        playRequestId: this.store.getPlayRequestId(),
        activeSessionId: this.store.getActiveSessionId(),
        message: 'meta.kind incompatible with target session',
      }
    }
    const start = request.targetQueue.items.find(
      (item) => item.id === request.startTrackId,
    )
    if (!start) {
      return {
        ok: false,
        reason: 'invalid_request',
        playRequestId: this.store.getPlayRequestId(),
        activeSessionId: this.store.getActiveSessionId(),
        message: 'startTrackId not in targetQueue.items',
      }
    }
    if (this.store.getUserId() == null) {
      return {
        ok: false,
        reason: 'logged_out',
        playRequestId: this.store.getPlayRequestId(),
        activeSessionId: this.store.getActiveSessionId(),
      }
    }

    const playRequestId = this.store.beginPlayRequest()
    const switchEpochAtStart = this.store.getSwitchEpoch()
    const targetGenAtStart = this.store.getSlot(request.target).slotGeneration
    const sourceSessionId = this.store.getActiveSessionId()
    const sourceHintAtPrepare =
      sourceSessionId !== null ? this.store.getSlot(sourceSessionId).queue : null

    this.pending = null
    this.phase = 'preparing'

    const playerGenerationAtPrepare = this.player.getGeneration()
    let prepared: PreparedTrackHandle
    try {
      prepared = await this.preparePort.prepareTrack({
        track: start,
        playRequestId,
        switchEpoch: switchEpochAtStart,
      })
    } catch (err) {
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'prepare_failed',
        playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: err instanceof Error ? err.message : 'prepare failed',
      }
    }

    if (!this.isFresh(playRequestId, switchEpochAtStart)) {
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
      }
    }

    // Validate: target slot generation не изменилась внешним replace
    this.phase = 'validating'
    if (this.store.getSlot(request.target).slotGeneration !== targetGenAtStart) {
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'validate_failed',
        playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: 'target slotGeneration changed during prepare',
      }
    }
    if (this.store.getUserId() == null) {
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'logged_out',
        playRequestId,
        activeSessionId: null,
      }
    }

    const token: SessionSwitchToken = {
      switchEpoch: switchEpochAtStart,
      playRequestId,
      target: request.target,
      targetSlotGeneration: targetGenAtStart,
      prepareId: this.createPrepareId(),
    }
    this.pending = {
      token,
      request,
      prepared,
      playerGenerationAtPrepare,
      sourceSessionId,
      sourceHintAtPrepare,
    }

    return this.commitPending()
  }

  private async commitPending(): Promise<SwitchResult> {
    const pending = this.pending
    if (!pending) {
      return {
        ok: false,
        reason: 'invalid_request',
        playRequestId: this.store.getPlayRequestId(),
        activeSessionId: this.store.getActiveSessionId(),
      }
    }

    const { token, request, prepared, playerGenerationAtPrepare, sourceSessionId } =
      pending

    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      this.pending = null
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
      }
    }

    this.phase = 'committing'

    // Snapshot непосредственно перед Commit (свежая позиция).
    const liveExport = this.queue.exportSessionState()
    const positionNow = this.player.getPositionSeconds()
    const playingId = this.player.getCurrentTrackId()
    const pendingRemovalIds = this.queue.getPendingRemovalIds()
    const sourceQueue = playbackExportToSessionQueue(liveExport, {
      positionSeconds: positionNow,
      playingTrackId: playingId,
      pendingRemovalIds,
      phase: 'user_paused',
      updatedAt: this.now(),
    })

    // Сохранить предыдущую активную сессию (если была).
    if (sourceSessionId) {
      const prevMeta = this.store.getSlot(sourceSessionId).meta
      this.store.replaceSlot(sourceSessionId, {
        meta: prevMeta,
        queue: sourceQueue,
      })
    }

    // Записать целевой слот (catalog A→B / album A→B — overwrite того же слота).
    this.store.replaceSlot(request.target, {
      meta: request.meta,
      queue: {
        ...request.targetQueue,
        updatedAt: request.targetQueue.updatedAt || this.now(),
      },
    })

    // Физическая очередь: import без legacy write (importSessionState detaches).
    const importResult = this.queue.importSessionState(
      sessionQueueToPlaybackQueueState(request.targetQueue),
    )
    if (!importResult.ok) {
      return this.rollbackAfterFailedCommit(pending, sourceQueue, {
        reason: 'commit_failed',
        message: 'live queue import failed',
      })
    }

    // Не bump switchEpoch до успеха физического play — иначе stale-логика сломается.
    const commitResult = await this.player.commitPlay({
      trackId: prepared.trackId,
      preparedRef: prepared.preparedRef,
      playRequestId: token.playRequestId,
      playerGenerationAtPrepare,
    })

    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      // Более новый Play уже идёт — не откатываем его успех.
      this.pending = null
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: 'skip rollback: newer play is in flight',
      }
    }

    if (!commitResult.ok) {
      if (commitResult.reason === 'user_gesture_required') {
        return this.rollbackAfterFailedCommit(pending, sourceQueue, {
          reason: 'user_gesture_required',
          message: commitResult.message,
        })
      }
      return this.rollbackAfterFailedCommit(pending, sourceQueue, {
        reason: 'commit_failed',
        message: commitResult.message ?? commitResult.reason,
      })
    }

    this.phase = 'finalizing'
    this.store.setActiveSessionId(request.target)
    const switchEpoch = this.store.bumpSwitchEpoch()
    this.pending = null
    this.phase = 'idle'

    const userId = this.store.getUserId()
    if (userId && this.persist.persistAfterCommit) {
      try {
        this.persist.persistAfterCommit({
          userId,
          deviceId: this.store.getDeviceId(),
          activeSessionId: request.target,
          sourceSessionId,
        })
      } catch {
        // best-effort; нет общей транзакции 5 ключей
      }
    }

    return {
      ok: true,
      activeSessionId: request.target,
      playRequestId: token.playRequestId,
      switchEpoch,
      playerGeneration: commitResult.playerGeneration,
    }
  }

  private async rollbackAfterFailedCommit(
    pending: PendingSwitch,
    sourceQueueSnapshot: SessionQueueSnapshot,
    failure: {
      reason:
        | 'commit_failed'
        | 'user_gesture_required'
        | 'rollback_partial'
        | 'prepare_failed'
      message?: string
    },
  ): Promise<SwitchResult> {
    this.phase = 'rolling_back'
    const { token, sourceSessionId, playerGenerationAtPrepare } = pending

    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      this.pending = null
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: 'skip rollback: superseded',
      }
    }

    // Восстановить live queue из снимка источника (логическое состояние).
    if (sourceSessionId) {
      this.store.setActiveSessionId(sourceSessionId)
      // source slot уже записан актуальным снимком перед commit
      this.queue.importSessionState(
        sessionQueueToPlaybackQueueState(sourceQueueSnapshot),
      )
    }

    const rollback = await this.player.rollbackPlay({
      trackId:
        sourceQueueSnapshot.currentIndex >= 0
          ? (sourceQueueSnapshot.items[sourceQueueSnapshot.currentIndex]?.id ??
            null)
          : null,
      positionSeconds: sourceQueueSnapshot.positionSeconds,
      playRequestId: token.playRequestId,
      playerGenerationAtPrepare,
    })

    this.pending = null
    this.phase = 'idle'

    if (!rollback.ok && rollback.reason === 'user_gesture_required') {
      return {
        ok: false,
        reason: 'user_gesture_required',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        phase: 'user_gesture_required',
        message: rollback.message,
      }
    }

    if (!rollback.ok && rollback.reason === 'unavailable') {
      return {
        ok: false,
        reason: 'rollback_partial',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: failure.message ?? 'physical restore unavailable',
      }
    }

    return {
      ok: false,
      reason: failure.reason,
      playRequestId: token.playRequestId,
      activeSessionId: this.store.getActiveSessionId(),
      message: failure.message,
      ...(failure.reason === 'user_gesture_required'
        ? { phase: 'user_gesture_required' as const }
        : {}),
    }
  }

  private isFresh(playRequestId: number, switchEpochAtStart: number): boolean {
    if (this.store.getUserId() == null) {
      return false
    }
    if (this.store.getPlayRequestId() !== playRequestId) {
      return false
    }
    // switchEpoch bump only after successful commit; during in-flight must match start
    if (this.store.getSwitchEpoch() !== switchEpochAtStart) {
      return false
    }
    return true
  }
}

export function createSessionSwitchCoordinator(
  options: SessionSwitchCoordinatorOptions,
): SessionSwitchCoordinator {
  return new SessionSwitchCoordinator(options)
}
