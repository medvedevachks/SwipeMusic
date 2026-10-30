import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type {
  CommitPlayInput,
  CommitPlayResult,
  LiveQueuePort,
  PhysicalPlayerPort,
  PreparedTrackHandle,
  RollbackPlayInput,
  RollbackPlayResult,
  SessionSwitchPersistPort,
  TrackPreparePort,
  TrackPrepareRequest,
} from './ports.ts'

export type FakePrepareOptions = {
  /** Delay before resolve — for race tests. */
  delayMs?: number
  fail?: boolean
  /** If set, pause detection: prepare must NOT call this. */
  onPauseAttempt?: () => void
  pauses?: number
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
      // Simulate non-destructive work — must never pause
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

export function wrapQueuePort(queue: PlaybackQueue): LiveQueuePort {
  return {
    exportSessionState: () => queue.exportSessionState(),
    importSessionState: (raw) => queue.importSessionState(raw),
    getPendingRemovalIds: () => queue.getPendingRemovalIds(),
    getPersistenceMode: () => queue.getPersistenceMode(),
    detachLegacyPersistence: () => queue.detachLegacyPersistence(),
  }
}

export type FakePlayerOptions = {
  commitFail?: CommitPlayResult & { ok: false }
  rollbackFail?: RollbackPlayResult & { ok: false }
  /** Track currently "playing" during Prepare (old music). */
  initialTrackId?: string | null
  initialPosition?: number
  initialGeneration?: number
}

export function createFakePlayerPort(
  options: FakePlayerOptions = {},
): PhysicalPlayerPort & {
  pauseCount: number
  commitCount: number
  rollbackCount: number
  pausedDuringPrepare: boolean
  setPlaying(trackId: string | null, position: number): void
  bumpGeneration(): number
} {
  let generation = options.initialGeneration ?? 1
  let trackId = options.initialTrackId ?? null
  let position = options.initialPosition ?? 0
  let pauseCount = 0
  let commitCount = 0
  let rollbackCount = 0
  let inPrepareWindow = true

  const api = {
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
      inPrepareWindow = false
      commitCount += 1
      if (input.playerGenerationAtPrepare !== generation) {
        // Newer physical play advanced generation
        return { ok: false, reason: 'stale' }
      }
      if (options.commitFail) {
        if (options.commitFail.reason === 'user_gesture_required') {
          return options.commitFail
        }
        pauseCount += 1
        return options.commitFail
      }
      generation += 1
      trackId = input.trackId
      position = 0
      return { ok: true, playerGeneration: generation }
    },
    async rollbackPlay(input: RollbackPlayInput): Promise<RollbackPlayResult> {
      rollbackCount += 1
      if (options.rollbackFail) {
        return options.rollbackFail
      }
      trackId = input.trackId
      position = input.positionSeconds
      return { ok: true, restored: input.trackId != null }
    },
    /** Test helper: simulate pause (should only happen on commit path). */
    pause() {
      pauseCount += 1
      void inPrepareWindow
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
      // never touch legacy
    },
  }
}
