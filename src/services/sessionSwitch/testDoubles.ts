import type {
  CommitPlayInput,
  CommitPlayResult,
  PhysicalPlayerPort,
  PreparedTrackHandle,
  RollbackPlayInput,
  RollbackPlayResult,
  SessionSwitchPersistPort,
  TrackPreparePort,
  TrackPrepareRequest,
} from './ports.ts'

export type FakePrepareOptions = {
  delayMs?: number
  fail?: boolean
}

export function createFakePreparePort(
  options: FakePrepareOptions = {},
): TrackPreparePort & { prepareCount: number; pauses: number } {
  const state = { prepareCount: 0, pauses: 0 }
  return {
    get prepareCount() {
      return state.prepareCount
    },
    get pauses() {
      return state.pauses
    },
    async prepareTrack(request: TrackPrepareRequest): Promise<PreparedTrackHandle> {
      state.prepareCount += 1
      if (options.delayMs) {
        await new Promise((r) => setTimeout(r, options.delayMs))
      }
      if (options.fail) {
        throw new Error('prepare failed')
      }
      return {
        trackId: request.track.id,
        preparedRef: `ref:${request.track.id}:${request.playRequestId}`,
      }
    },
  }
}

export { wrapQueuePort } from './liveQueuePort.ts'

export type FakePlayerOptions = {
  commitFail?: CommitPlayResult & { ok: false }
  rollbackFail?: RollbackPlayResult & { ok: false }
  initialTrackId?: string | null
  initialPosition?: number
  initialGeneration?: number
  /** Simulate slow physical commit (race tests). */
  commitDelayMs?: number
}

/**
 * Fake physical port с claim-generation на входе commitPlay (DEV-04A контракт).
 */
export function createFakePlayerPort(
  options: FakePlayerOptions = {},
): PhysicalPlayerPort & {
  pauseCount: number
  commitCount: number
  rollbackCount: number
  pausedDuringPrepare: boolean
  /** Одноразовая задержка следующего commitPlay (для гонок). */
  nextCommitDelayMs: number | null
  setPlaying(trackId: string | null, position: number): void
  bumpGeneration(): number
} {
  let generation = options.initialGeneration ?? 1
  let trackId = options.initialTrackId ?? null
  let position = options.initialPosition ?? 0
  let pauseCount = 0
  let commitCount = 0
  let rollbackCount = 0

  const api = {
    nextCommitDelayMs: null as number | null,
    get pauseCount() {
      return pauseCount
    },
    get commitCount() {
      return commitCount
    },
    get rollbackCount() {
      return rollbackCount
    },
    get pausedDuringPrepare() {
      return pauseCount > 0 && commitCount === 0
    },
    setPlaying(id: string | null, pos: number) {
      trackId = id
      position = pos
    },
    bumpGeneration() {
      generation += 1
      return generation
    },
    getGeneration() {
      return generation
    },
    getCurrentTrackId() {
      return trackId
    },
    getPositionSeconds() {
      return position
    },
    async commitPlay(input: CommitPlayInput): Promise<CommitPlayResult> {
      commitCount += 1
      void input.playerGenerationAtPrepare
      // Claim immediately BEFORE any await — устаревший commit после
      // более нового claim не перезапишет playback (DEV-04A).
      const commitClaimGeneration = ++generation

      const delay =
        api.nextCommitDelayMs ?? options.commitDelayMs ?? 0
      api.nextCommitDelayMs = null
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
      }

      if (generation !== commitClaimGeneration) {
        return {
          ok: false,
          reason: 'cancelled',
          message: 'commit superseded after claim; newer playback untouched',
        }
      }

      if (options.commitFail) {
        if (options.commitFail.reason === 'user_gesture_required') {
          return options.commitFail
        }
        pauseCount += 1
        return options.commitFail
      }

      trackId = input.trackId
      position = 0
      return { ok: true, playerGeneration: generation }
    },
    async rollbackPlay(input: RollbackPlayInput): Promise<RollbackPlayResult> {
      rollbackCount += 1
      // Не откатывать звук, если уже есть более новый commit claim
      if (
        input.commitClaimGeneration != null &&
        generation !== input.commitClaimGeneration
      ) {
        return { ok: false, reason: 'cancelled', message: 'rollback superseded' }
      }
      if (options.rollbackFail) {
        return options.rollbackFail
      }
      trackId = input.trackId
      position = input.positionSeconds
      return { ok: true, restored: input.trackId != null }
    },
    pause() {
      pauseCount += 1
    },
  }
  return api
}

export function createFakePersistPort(): SessionSwitchPersistPort & {
  legacyWrites: number
  commits: number
} {
  const state = { legacyWrites: 0, commits: 0 }
  return {
    writesLegacyV1: false,
    get legacyWrites() {
      return state.legacyWrites
    },
    get commits() {
      return state.commits
    },
    persistAfterCommit() {
      state.commits += 1
    },
  }
}
