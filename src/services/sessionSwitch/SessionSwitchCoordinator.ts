/**
 * Координатор Prepare → Validate → Commit → Finalize/Rollback (PLAYBACK-DEV-04/04A).
 * Не подключён к PlaybackIntent / production AudioPlayer (DEV-05).
 */
import type { PlaybackSessionStore } from '../playbackSession/PlaybackSessionStore.ts'
import {
  clonePlaybackSessionSlot,
  isMetaCompatibleWithSession,
} from '../playbackSession/clone.ts'
import type {
  PlaybackSessionId,
  PlaybackSessionSlot,
  SessionPlaybackPhase,
  SessionQueueSnapshot,
  SessionSwitchToken,
} from '../playbackSession/types.ts'
import {
  captureRuntimePlaybackAnchor,
  playbackExportToSessionQueue,
  sessionQueueToPlaybackQueueState,
} from './queueSnapshotBridge.ts'
import type {
  LiveQueuePort,
  LiveRuntimeCapture,
  PhysicalPlayerPort,
  PreparedTrackHandle,
  RuntimePlaybackAnchor,
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
      activeSessionId: PlaybackSessionId | null
      phase?: SessionPlaybackPhase
    }

type PendingSwitch = {
  token: SessionSwitchToken
  request: SwitchPlayRequest
  prepared: PreparedTrackHandle
  playerGenerationAtPrepare: number
  sourceSessionId: PlaybackSessionId | null
  /** Предыдущее содержимое целевого слота до overwrite — для полного rollback. */
  previousTargetSlot: PlaybackSessionSlot | null
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

  onUiNavigation(_path?: string): void {
    this.uiNavigationCount += 1
  }

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
    const previousTargetSlot = clonePlaybackSessionSlot(
      this.store.getSlot(request.target),
    )

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

    // После await Prepare
    if (!this.isFresh(playRequestId, switchEpochAtStart)) {
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
      }
    }

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
      previousTargetSlot,
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

    // --- Снимки непосредственно перед мутацией ---
    const runtimeCapture: LiveRuntimeCapture = this.queue.exportRuntimeSessionState()
    const positionNow = this.player.getPositionSeconds()
    const playingId = this.player.getCurrentTrackId()
    const pendingRemovalIds = this.queue.getPendingRemovalIds()

    const runtimeAnchor = captureRuntimePlaybackAnchor({
      playingTrackId: playingId,
      positionSeconds: positionNow,
      pendingRemovalIds,
    })

    // Durable для SessionStore (призраки вычищены, позиция не на чужой трек)
    const durableSourceQueue = playbackExportToSessionQueue(
      this.queue.exportSessionState(),
      {
        positionSeconds: positionNow,
        playingTrackId: playingId,
        pendingRemovalIds,
        phase: 'user_paused',
        updatedAt: this.now(),
      },
    )

    // 1) Сохранить source slot (durable)
    if (sourceSessionId) {
      const prevMeta = this.store.getSlot(sourceSessionId).meta
      this.store.replaceSlot(sourceSessionId, {
        meta: prevMeta,
        queue: durableSourceQueue,
      })
    }

    // 2) Overwrite target (предыдущий target сохранён в previousTargetSlot)
    this.store.replaceSlot(request.target, {
      meta: request.meta,
      queue: {
        ...request.targetQueue,
        updatedAt: request.targetQueue.updatedAt || this.now(),
      },
    })

    // 3) Live queue → target
    const importResult = this.queue.importSessionState(
      sessionQueueToPlaybackQueueState(request.targetQueue),
    )
    if (!importResult.ok) {
      return this.rollbackAfterFailedCommit(pending, {
        durableSourceQueue,
        runtimeCapture,
        runtimeAnchor,
        failure: {
          reason: 'commit_failed',
          message: 'live queue import failed',
        },
      })
    }

    // После мутаций — снова свежесть перед физическим commit
    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      return this.rollbackAfterFailedCommit(pending, {
        durableSourceQueue,
        runtimeCapture,
        runtimeAnchor,
        failure: {
          reason: 'stale',
          message: 'superseded before physical commit',
        },
        skipPhysicalRollback: true,
      })
    }

    const commitResult = await this.player.commitPlay({
      trackId: prepared.trackId,
      preparedRef: prepared.preparedRef,
      playRequestId: token.playRequestId,
      playerGenerationAtPrepare,
    })

    // После await commitPlay
    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      this.pending = null
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: 'skip rollback: newer play owns the player',
      }
    }

    if (!commitResult.ok) {
      if (
        commitResult.reason === 'stale' ||
        commitResult.reason === 'cancelled'
      ) {
        this.pending = null
        this.phase = 'idle'
        return {
          ok: false,
          reason: 'stale',
          playRequestId: token.playRequestId,
          activeSessionId: this.store.getActiveSessionId(),
          message: commitResult.message ?? commitResult.reason,
        }
      }
      if (commitResult.reason === 'user_gesture_required') {
        return this.rollbackAfterFailedCommit(pending, {
          durableSourceQueue,
          runtimeCapture,
          runtimeAnchor,
          failure: {
            reason: 'user_gesture_required',
            message: commitResult.message,
          },
        })
      }
      return this.rollbackAfterFailedCommit(pending, {
        durableSourceQueue,
        runtimeCapture,
        runtimeAnchor,
        failure: {
          reason: 'commit_failed',
          message: commitResult.message ?? commitResult.reason,
        },
      })
    }

    // Успех: ещё раз свежесть перед finalize
    if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
      this.pending = null
      this.phase = 'idle'
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: 'superseded after physical commit; leaving newer owner intact',
      }
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
        // best-effort
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
    args: {
      durableSourceQueue: SessionQueueSnapshot
      runtimeCapture: LiveRuntimeCapture
      runtimeAnchor: RuntimePlaybackAnchor
      failure: {
        reason:
          | 'commit_failed'
          | 'user_gesture_required'
          | 'rollback_partial'
          | 'prepare_failed'
          | 'stale'
        message?: string
      }
      skipPhysicalRollback?: boolean
    },
  ): Promise<SwitchResult> {
    this.phase = 'rolling_back'
    const { token, sourceSessionId, previousTargetSlot, playerGenerationAtPrepare } =
      pending
    const {
      durableSourceQueue,
      runtimeCapture,
      runtimeAnchor,
      failure,
      skipPhysicalRollback,
    } = args

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

    // Транзакционный откат целевого слота (не потерять прежний SEARCH и т.п.)
    if (previousTargetSlot) {
      this.store.replaceSlot(previousTargetSlot.id, {
        meta: previousTargetSlot.meta,
        queue: previousTargetSlot.queue,
      })
    }

    // Восстановить active + live runtime (с pending ghosts)
    if (sourceSessionId) {
      this.store.setActiveSessionId(sourceSessionId)
      // durable slot уже записан актуальным durableSourceQueue
      void durableSourceQueue
      this.queue.importRuntimeSessionState(
        runtimeCapture.state,
        runtimeCapture.pendingRemovalIds,
      )
    }

    if (!skipPhysicalRollback) {
      const rollback = await this.player.rollbackPlay({
        trackId: runtimeAnchor.trackId,
        positionSeconds: runtimeAnchor.positionSeconds,
        playRequestId: token.playRequestId,
        playerGenerationAtPrepare,
      })

      // После await rollback
      if (!this.isFresh(token.playRequestId, token.switchEpoch)) {
        this.pending = null
        this.phase = 'idle'
        return {
          ok: false,
          reason: 'stale',
          playRequestId: token.playRequestId,
          activeSessionId: this.store.getActiveSessionId(),
          message: 'skip completing rollback: superseded',
        }
      }

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

      if (
        !rollback.ok &&
        (rollback.reason === 'unavailable' || rollback.reason === 'error')
      ) {
        return {
          ok: false,
          reason: 'rollback_partial',
          playRequestId: token.playRequestId,
          activeSessionId: this.store.getActiveSessionId(),
          message: failure.message ?? 'physical restore unavailable',
        }
      }
    } else {
      this.pending = null
      this.phase = 'idle'
    }

    if (failure.reason === 'stale') {
      return {
        ok: false,
        reason: 'stale',
        playRequestId: token.playRequestId,
        activeSessionId: this.store.getActiveSessionId(),
        message: failure.message,
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
