/**
 * PhysicalPlayerPort: один адаптер, generation ownership, без второго плеера.
 */
import type { PlaybackCandidate } from '../../playbackResolver/types.ts'
import type { Track } from '../../../types/track.ts'
import type { PlayerAdapter } from '../../audioPlayer/PlayerAdapter.ts'
import type {
  CommitPlayInput,
  CommitPlayResult,
  PhysicalPlayerPort,
  RollbackPlayInput,
  RollbackPlayResult,
} from '../ports.ts'
import type { PreparedTrackCache } from './preparedTrackCache.ts'
import {
  commitPreparedPlayback,
  rollbackPreparedPlayback,
  type SessionPhysicalCallbacks,
} from './sessionPhysicalEngine.ts'

export type PhysicalPortState = {
  currentTrack: Track | null
  pendingTrack: Track | null
  activeCandidate: PlaybackCandidate | null
  currentTime: number
  playing: boolean
  paused: boolean
  loading: boolean
  buffering: boolean
  error: string | null
  /** phase hint for UI: sounding vs preparing */
  uiPhase: 'idle' | 'preparing_elsewhere' | 'committing' | 'playing' | 'user_gesture_required'
}

export type AdapterPhysicalPort = PhysicalPlayerPort & {
  getState(): PhysicalPortState
  /** Симулировать звучание до switch (тесты / bootstrap). */
  seedPlaying(track: Track, url: string, positionSeconds?: number): void
  getAdapter(): PlayerAdapter
}

export type CreateAdapterPhysicalPortOptions = {
  adapter: PlayerAdapter
  cache: PreparedTrackCache
  /** Lookup track by id for rollback when URL известен из cache/seed. */
  resolveTrackById?: (trackId: string) => Track | null
}

export function createAdapterPhysicalPort(
  options: CreateAdapterPhysicalPortOptions,
): AdapterPhysicalPort {
  const { adapter, cache } = options
  let playGeneration = 1
  let state: PhysicalPortState = {
    currentTrack: null,
    pendingTrack: null,
    activeCandidate: null,
    currentTime: 0,
    playing: false,
    paused: true,
    loading: false,
    buffering: false,
    error: null,
    uiPhase: 'idle',
  }

  /** URL, с которым реально играет currentTrack (не в localStorage). */
  let soundingUrl: string | null = null
  /** Снимок до commit — для rollback. */
  let preCommit: {
    track: Track | null
    url: string | null
    position: number
    playRequestId: number
  } | null = null

  const generation = {
    getGeneration: () => playGeneration,
    claimGeneration: () => {
      playGeneration += 1
      return playGeneration
    },
  }

  const callbacks: SessionPhysicalCallbacks = {
    onPending(track) {
      state = {
        ...state,
        pendingTrack: track,
        loading: true,
        buffering: true,
        playing: false,
        paused: true,
        error: null,
        uiPhase: 'committing',
      }
    },
    onCommitted(track, candidate) {
      soundingUrl = track.previewUrl ?? soundingUrl
      state = {
        ...state,
        currentTrack: track,
        pendingTrack: null,
        activeCandidate: candidate,
        currentTime: 0,
        loading: true,
        buffering: true,
        error: null,
      }
    },
    onPlaying() {
      state = {
        ...state,
        playing: true,
        paused: false,
        loading: false,
        buffering: false,
        pendingTrack: null,
        uiPhase: 'playing',
        currentTime: adapter.getCurrentTime(),
      }
    },
    onUserGestureRequired() {
      state = {
        ...state,
        pendingTrack: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error: null,
        uiPhase: 'user_gesture_required',
      }
    },
    onFailed(message) {
      state = {
        ...state,
        pendingTrack: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error: message,
        uiPhase: 'idle',
      }
    },
    onRollbackUnavailable() {
      state = {
        ...state,
        pendingTrack: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        uiPhase: 'idle',
      }
    },
    onRollbackRestored(track) {
      soundingUrl = track.previewUrl ?? soundingUrl
      state = {
        ...state,
        currentTrack: track,
        pendingTrack: null,
        currentTime: adapter.getCurrentTime(),
        error: null,
      }
    },
  }

  return {
    getAdapter: () => adapter,
    getState: () => ({ ...state }),
    seedPlaying(track, url, positionSeconds = 0) {
      soundingUrl = url
      state = {
        ...state,
        currentTrack: { ...track, previewUrl: url },
        pendingTrack: null,
        currentTime: positionSeconds,
        playing: true,
        paused: false,
        uiPhase: 'playing',
      }
      // Не вызываем adapter.play здесь обязательно — тесты могут seed'ить логическое состояние
      // и отдельно запустить adapter.
    },
    getGeneration() {
      return playGeneration
    },
    getCurrentTrackId() {
      return state.currentTrack?.id ?? null
    },
    getPositionSeconds() {
      if (state.playing || state.paused) {
        const t = adapter.getCurrentTime()
        if (Number.isFinite(t) && t > 0) {
          return t
        }
      }
      return state.currentTime
    },
    async commitPlay(input: CommitPlayInput): Promise<CommitPlayResult> {
      const prepared = cache.get(input.preparedRef)
      if (!prepared) {
        return {
          ok: false,
          reason: 'error',
          message: 'preparedRef missing (prepare cache)',
        }
      }

      preCommit = {
        track: state.currentTrack,
        url: soundingUrl ?? state.currentTrack?.previewUrl ?? null,
        position: this.getPositionSeconds(),
        playRequestId: input.playRequestId,
      }

      const result = await commitPreparedPlayback({
        track: prepared.track,
        url: prepared.url,
        candidate: prepared.candidate,
        adapter,
        generation,
        callbacks,
      })

      if (result.ok) {
        cache.take(input.preparedRef)
        soundingUrl = prepared.url
      }

      return result
    },
    async rollbackPlay(input: RollbackPlayInput): Promise<RollbackPlayResult> {
      const snap = preCommit
      let track: Track | null = null
      let url: string | null = null

      if (input.trackId && snap?.track?.id === input.trackId) {
        track = snap.track
        url = snap.url
      } else if (input.trackId) {
        track =
          options.resolveTrackById?.(input.trackId) ??
          (state.currentTrack?.id === input.trackId ? state.currentTrack : null)
        url =
          track?.previewUrl ??
          (snap?.track?.id === input.trackId ? snap.url : null) ??
          soundingUrl
      }

      const position =
        snap && snap.playRequestId === input.playRequestId
          ? snap.position
          : input.positionSeconds

      const result = await rollbackPreparedPlayback({
        track,
        url,
        positionSeconds: position,
        adapter,
        generation,
        callbacks,
        commitClaimGeneration: input.commitClaimGeneration,
      })

      if (result.ok && result.restored && url) {
        soundingUrl = url
      }
      return result
    },
  }
}

/**
 * Production-обёртка: PhysicalPlayerPort делегирует в AudioPlayer session API.
 * Тип duck-typed, чтобы не тянуть AudioPlayer в node:test graph.
 */
export type AudioPlayerSessionApi = {
  getPlayGeneration(): number
  getState(): {
    currentTrack: Track | null
    currentTime: number
  }
  commitSessionPlay(input: {
    track: Track
    url: string
    candidate: PlaybackCandidate | null
  }): Promise<CommitPlayResult>
  rollbackSessionPlay(input: {
    track: Track | null
    url: string | null
    positionSeconds: number
    commitClaimGeneration?: number
  }): Promise<RollbackPlayResult>
}

export function createAudioPlayerPhysicalPort(
  player: AudioPlayerSessionApi,
  cache: PreparedTrackCache,
): PhysicalPlayerPort {
  let preCommit: {
    track: Track | null
    url: string | null
    position: number
    playRequestId: number
  } | null = null

  return {
    getGeneration() {
      return player.getPlayGeneration()
    },
    getCurrentTrackId() {
      return player.getState().currentTrack?.id ?? null
    },
    getPositionSeconds() {
      return player.getState().currentTime
    },
    async commitPlay(input: CommitPlayInput): Promise<CommitPlayResult> {
      const prepared = cache.get(input.preparedRef)
      if (!prepared) {
        return {
          ok: false,
          reason: 'error',
          message: 'preparedRef missing (prepare cache)',
        }
      }
      const st = player.getState()
      preCommit = {
        track: st.currentTrack,
        url: st.currentTrack?.previewUrl ?? null,
        position: st.currentTime,
        playRequestId: input.playRequestId,
      }
      const result = await player.commitSessionPlay({
        track: prepared.track,
        url: prepared.url,
        candidate: prepared.candidate,
      })
      if (result.ok) {
        cache.take(input.preparedRef)
      }
      return result
    },
    async rollbackPlay(input: RollbackPlayInput): Promise<RollbackPlayResult> {
      const snap = preCommit
      const track =
        snap && input.trackId && snap.track?.id === input.trackId
          ? snap.track
          : null
      const url = snap?.url ?? track?.previewUrl ?? null
      const position =
        snap && snap.playRequestId === input.playRequestId
          ? snap.position
          : input.positionSeconds
      return player.rollbackSessionPlay({
        track,
        url,
        positionSeconds: position,
        commitClaimGeneration: input.commitClaimGeneration,
      })
    },
  }
}
