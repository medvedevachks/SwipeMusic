export type FallbackCancelReason = 'next' | 'previous' | 'manual-play' | 'logout' | 'stop'

type CancelHandler = (reason: FallbackCancelReason) => void
type MediaErrorHandler = (positionSeconds: number) => void

let cancelHandler: CancelHandler | null = null
let mediaErrorHandler: MediaErrorHandler | null = null

export function bindFallbackCancellation(handler: CancelHandler): void {
  cancelHandler = handler
}

export function bindMediaError(handler: MediaErrorHandler): void {
  mediaErrorHandler = handler
}

export function cancelActiveFallback(reason: FallbackCancelReason): void {
  cancelHandler?.(reason)
}

/** Реальный media error уже начатого playback. Не polling. */
export function emitPlaybackMediaError(positionSeconds: number): void {
  mediaErrorHandler?.(positionSeconds)
}

/**
 * Next/Previous: сначала гасим fallback, затем один шаг существующей очереди.
 */
export function beginQueueTransport(action: 'next' | 'previous', advance: () => void): void {
  cancelActiveFallback(action)
  advance()
}
