/**
 * Prefetch-буфер следующих кандидатов continuous-random-v1.
 * Не скачивает аудио и не резолвит stream URL — только Track metadata.
 */
import type { Track } from '../../types/track.ts'
import { copyIdentity, titleIdentity } from './identity.ts'
import { noteContinuousDiag } from './continuousDiag.ts'

export const CONTINUOUS_BUFFER_TARGET = 4

let buffer: Track[] = []
let generation = 0
let fillInflight: Promise<void> | null = null

export function getContinuousBufferSize(): number {
  return buffer.length
}

export function peekContinuousBuffer(): readonly Track[] {
  return buffer
}

export function invalidateContinuousBuffer(reason = 'invalidate'): void {
  generation += 1
  buffer = []
  fillInflight = null
  noteContinuousDiag({
    mode: 'swipe',
    phase: 'buffer-fill',
    reason,
    bufferSize: 0,
  })
}

export function takeContinuousBufferedTrack(excludeIds: ReadonlySet<string>): Track | null {
  while (buffer.length > 0) {
    const next = buffer.shift()!
    if (excludeIds.has(next.id)) {
      continue
    }
    noteContinuousDiag({
      mode: 'swipe',
      phase: 'buffer-take',
      trackId: next.id,
      bufferSize: buffer.length,
    })
    return next
  }
  return null
}

export function pushContinuousBufferedTracks(
  tracks: readonly Track[],
  options: { generation: number; excludeIds?: ReadonlySet<string> },
): void {
  if (options.generation !== generation) {
    return
  }
  const seen = new Set(
    buffer.flatMap((track) => [
      track.id,
      copyIdentity(track),
      titleIdentity(track.artist, track.title),
    ]),
  )
  for (const id of options.excludeIds ?? []) {
    seen.add(id)
  }
  for (const track of tracks) {
    if (buffer.length >= CONTINUOUS_BUFFER_TARGET) {
      break
    }
    const keys = [track.id, copyIdentity(track), titleIdentity(track.artist, track.title)]
    if (keys.some((key) => seen.has(key))) {
      continue
    }
    for (const key of keys) {
      seen.add(key)
    }
    buffer.push(track)
  }
  noteContinuousDiag({
    mode: 'swipe',
    phase: 'buffer-fill',
    found: tracks.length,
    bufferSize: buffer.length,
  })
}

export function beginContinuousBufferFill(
  run: (generation: number) => Promise<void>,
): void {
  if (buffer.length >= CONTINUOUS_BUFFER_TARGET) {
    return
  }
  if (fillInflight) {
    return
  }
  const gen = generation
  fillInflight = run(gen)
    .catch(() => undefined)
    .finally(() => {
      if (generation === gen) {
        fillInflight = null
      }
    })
}

export function getContinuousBufferGeneration(): number {
  return generation
}

export function resetContinuousBufferForTests(): void {
  invalidateContinuousBuffer('test-reset')
  generation = 0
}
