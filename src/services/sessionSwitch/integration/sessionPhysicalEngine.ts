/**
 * Generation-owned commit / rollback поверх одного PlayerAdapter.
 * Используется AudioPlayer (production) и adapter-backed PhysicalPort (тесты).
 *
 * Контракт DEV-04A/05:
 * - claim generation ДО любого await
 * - после каждого await: если generation сменилась → cancelled, без pause/stop
 * - currentTrack коммитится только после успешного load
 */
import type { PlaybackCandidate } from '../../playbackResolver/types.ts'
import type { Track } from '../../../types/track.ts'
import type { PlayerAdapter } from '../../audioPlayer/PlayerAdapter.ts'
import type { CommitPlayResult, RollbackPlayResult } from '../ports.ts'

export type SessionPhysicalCallbacks = {
  onPending(track: Track): void
  onCommitted(track: Track, candidate: PlaybackCandidate | null): void
  onPlaying(): void
  onUserGestureRequired(): void
  onFailed(message: string): void
  onRollbackUnavailable(): void
  onRollbackRestored(track: Track): void
}

export type SessionPhysicalGeneration = {
  getGeneration(): number
  /** Bump и вернуть новое значение (claim). */
  claimGeneration(): number
}

function isAutoplayBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const name = error.name
  const message = error.message.toLowerCase()
  return (
    name === 'NotAllowedError' ||
    message.includes("user didn't interact") ||
    message.includes('play() failed because the user') ||
    message.includes('notallowederror')
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isStale(claim: number, getGeneration: () => number): boolean {
  return claim !== getGeneration()
}

export type CommitPreparedInput = {
  track: Track
  url: string
  candidate: PlaybackCandidate | null
  adapter: PlayerAdapter
  generation: SessionPhysicalGeneration
  callbacks: SessionPhysicalCallbacks
}

/**
 * Физический commit подготовленного URL.
 * Не резолвит источник и не мутирует очередь.
 */
export async function commitPreparedPlayback(
  input: CommitPreparedInput,
): Promise<CommitPlayResult> {
  const { track, url, candidate, adapter, generation, callbacks } = input

  // 1) Claim ДО любого await
  const claim = generation.claimGeneration()
  callbacks.onPending(track)

  try {
    await Promise.resolve(adapter.pause())
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'commit superseded after pause',
      }
    }

    await adapter.load(url)
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'commit superseded after load',
      }
    }

    // Identity только после успешного load
    const trackWithUrl: Track = { ...track, previewUrl: url }
    callbacks.onCommitted(trackWithUrl, candidate)

    await adapter.play()
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'commit superseded after play',
      }
    }

    callbacks.onPlaying()
    return { ok: true, playerGeneration: claim }
  } catch (error) {
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'commit superseded during error path',
      }
    }
    if (isAbortError(error)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'commit aborted',
      }
    }
    if (isAutoplayBlockedError(error)) {
      callbacks.onUserGestureRequired()
      return {
        ok: false,
        reason: 'user_gesture_required',
        message: error instanceof Error ? error.message : 'NotAllowedError',
      }
    }
    const message =
      error instanceof Error ? error.message : 'Failed to commit playback'
    callbacks.onFailed(message)
    return { ok: false, reason: 'load_failed', message }
  }
}

export type RollbackPreparedInput = {
  track: Track | null
  url: string | null
  positionSeconds: number
  adapter: PlayerAdapter
  generation: SessionPhysicalGeneration
  callbacks: SessionPhysicalCallbacks
  /**
   * Если задан — rollback принадлежит этому claim (после failed commit).
   * Иначе claim'аем новый generation.
   */
  commitClaimGeneration?: number
}

export async function rollbackPreparedPlayback(
  input: RollbackPreparedInput,
): Promise<RollbackPlayResult> {
  const { track, url, positionSeconds, adapter, generation, callbacks } = input

  let claim: number
  if (
    typeof input.commitClaimGeneration === 'number' &&
    input.commitClaimGeneration === generation.getGeneration()
  ) {
    // Тот же claim, что у failed commit — не bump'аем снова
    claim = input.commitClaimGeneration
  } else if (
    typeof input.commitClaimGeneration === 'number' &&
    input.commitClaimGeneration !== generation.getGeneration()
  ) {
    return {
      ok: false,
      reason: 'stale',
      message: 'rollback claim superseded by newer play',
    }
  } else {
    claim = generation.claimGeneration()
  }

  if (!track || !url) {
    try {
      await Promise.resolve(adapter.pause())
    } catch {
      /* best-effort */
    }
    callbacks.onRollbackUnavailable()
    return { ok: true, restored: false }
  }

  try {
    await adapter.load(url)
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'rollback superseded after load',
      }
    }

    const restored: Track = { ...track, previewUrl: url }
    callbacks.onRollbackRestored(restored)
    adapter.seek(Math.max(0, positionSeconds))

    await adapter.play()
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'rollback superseded after play',
      }
    }

    callbacks.onPlaying()
    return { ok: true, restored: true }
  } catch (error) {
    if (isStale(claim, generation.getGeneration)) {
      return {
        ok: false,
        reason: 'cancelled',
        message: 'rollback superseded during error',
      }
    }
    if (isAutoplayBlockedError(error)) {
      callbacks.onUserGestureRequired()
      return {
        ok: false,
        reason: 'user_gesture_required',
        message: error instanceof Error ? error.message : 'NotAllowedError',
      }
    }
    callbacks.onRollbackUnavailable()
    return {
      ok: false,
      reason: 'unavailable',
      message: error instanceof Error ? error.message : 'rollback failed',
    }
  }
}
