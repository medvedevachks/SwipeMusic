/**
 * Безопасная диагностика continuous-random-v1.
 * Без токенов, cookies, stream URL, email и PII.
 */

export type ContinuousDiagEvent = {
  at: string
  mode: 'swipe' | 'wave' | 'search' | string
  source?: string
  phase:
    | 'discovery-start'
    | 'discovery-query'
    | 'candidates'
    | 'reject'
    | 'select'
    | 'buffer-fill'
    | 'buffer-take'
    | 'playback-miss'
    | 'soft-miss'
    | 'hard-miss'
  query?: string
  found?: number
  rejected?: number
  playable?: number
  unknown?: number
  unavailable?: number
  reason?: string
  trackId?: string | null
  bufferSize?: number
  timedOut?: boolean
}

const MAX_EVENTS = 80
const events: ContinuousDiagEvent[] = []
const listeners = new Set<(event: ContinuousDiagEvent) => void>()

export function noteContinuousDiag(event: Omit<ContinuousDiagEvent, 'at'>): void {
  const full: ContinuousDiagEvent = {
    ...event,
    at: new Date().toISOString(),
  }
  events.push(full)
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }
  for (const listener of listeners) {
    try {
      listener(full)
    } catch {
      // diag never breaks playback
    }
  }
}

export function getContinuousDiagEvents(): readonly ContinuousDiagEvent[] {
  return events
}

export function clearContinuousDiagForTests(): void {
  events.length = 0
}

export function subscribeContinuousDiag(
  listener: (event: ContinuousDiagEvent) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
