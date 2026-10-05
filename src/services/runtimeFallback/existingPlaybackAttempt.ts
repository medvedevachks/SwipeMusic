import type { Track } from '../../types/track.ts'
import type {
  PlaybackAttemptOutcome,
  PlaybackAttemptPort,
  PlaybackAttemptRequest,
} from '../../types/runtimeFallback.ts'

export type PlaybackSurface = {
  playTrack: (track: Track, options?: { preserveQueue?: boolean }) => Promise<void>
  pause: () => void
  seek: (timeSeconds: number) => void
  getState: () => {
    currentTrack: { id: string } | null
    currentTime: number
    error: string | null
    playing: boolean
  }
}

/**
 * Мост к существующему PlaybackResolver → AudioPlayer.
 * Очередь не двигает: попытка идёт с preserveQueue.
 */
export function createExistingPipelineAttemptPort(): PlaybackAttemptPort {
  return {
    async stopPrevious() {
      const player = await loadPlayer()
      player.pause()
    },
    async attempt(request) {
      const player = await loadPlayer()
      return attemptOnPlayer(player, request)
    },
  }
}

export async function attemptOnPlayer(
  player: PlaybackSurface,
  request: PlaybackAttemptRequest,
): Promise<PlaybackAttemptOutcome> {
  if (request.signal.aborted) {
    return cancelledOutcome()
  }
  try {
    await player.playTrack(request.track, { preserveQueue: true })
  } catch (error) {
    if (superseded(player, request)) {
      return cancelledOutcome()
    }
    if (isAutoplayBlockedError(error) && ownsCurrentTrack(player, request)) {
      return applyResume(player, request)
    }
    return failureOutcome(player, request)
  }
  if (superseded(player, request)) {
    return cancelledOutcome()
  }
  const state = player.getState()
  if (state.error || state.currentTrack?.id !== request.track.id) {
    return failureOutcome(player, request)
  }
  return applyResume(player, request)
}

async function loadPlayer(): Promise<PlaybackSurface> {
  const { getAudioPlayer } = await import('../audioPlayer/index.ts')
  return getAudioPlayer()
}

function ownsCurrentTrack(player: PlaybackSurface, request: PlaybackAttemptRequest): boolean {
  return player.getState().currentTrack?.id === request.track.id
}

function superseded(player: PlaybackSurface, request: PlaybackAttemptRequest): boolean {
  if (request.signal.aborted) {
    return true
  }
  const currentId = player.getState().currentTrack?.id
  return currentId != null && currentId !== request.track.id
}

function failureOutcome(
  player: PlaybackSurface,
  request: PlaybackAttemptRequest,
): PlaybackAttemptOutcome {
  const state = player.getState()
  const own = state.currentTrack == null || state.currentTrack.id === request.track.id
  const position = state.currentTime
  return {
    ok: false,
    positionSeconds: own && Number.isFinite(position) ? position : null,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  }
}

function applyResume(
  player: PlaybackSurface,
  request: PlaybackAttemptRequest,
): PlaybackAttemptOutcome {
  const position = request.resumePositionSeconds
  if (position == null || position <= 0) {
    return {
      ok: true,
      resumeAttempted: false,
      resumeSucceeded: false,
      resumeUnsupported: false,
    }
  }
  if (typeof player.seek !== 'function') {
    return {
      ok: true,
      resumeAttempted: false,
      resumeSucceeded: false,
      resumeUnsupported: true,
    }
  }
  player.seek(position)
  const after = player.getState().currentTime
  const succeeded = Number.isFinite(after) && Math.abs(after - position) < 1.5
  return {
    ok: true,
    resumeAttempted: true,
    resumeSucceeded: succeeded,
    resumeUnsupported: !succeeded,
  }
}

function cancelledOutcome(): PlaybackAttemptOutcome {
  return {
    ok: false,
    cancelled: true,
    positionSeconds: null,
    resumeAttempted: false,
    resumeSucceeded: false,
    resumeUnsupported: false,
  }
}

function isAutoplayBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return (
    error.name === 'NotAllowedError' ||
    message.includes('notallowederror') ||
    message.includes("user didn't interact")
  )
}
