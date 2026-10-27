/**
 * Dev-only журнал Media Session.
 * В production-сборке запись не ведётся.
 */

export type DevMediaSessionEntry = {
  id: string
  at: number
  message: string
  detail?: string
}

type Listener = (entries: DevMediaSessionEntry[]) => void

const MAX_ENTRIES = 40

let entries: DevMediaSessionEntry[] = []
const listeners = new Set<Listener>()
let seq = 0

function notify(): void {
  const snapshot = [...entries]
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function pushDevMediaSessionLog(input: {
  message: string
  detail?: string
  at?: number
}): void {
  if (import.meta.env?.DEV !== true) {
    return
  }
  seq += 1
  entries = [
    ...entries,
    {
      id: `media-session-${seq}`,
      at: input.at ?? Date.now(),
      message: input.message,
      detail: input.detail,
    },
  ].slice(-MAX_ENTRIES)
  notify()
}

export function clearDevMediaSessionLog(): void {
  if (import.meta.env?.DEV !== true) {
    return
  }
  entries = []
  notify()
}

export function getDevMediaSessionLog(): DevMediaSessionEntry[] {
  return [...entries]
}

export function subscribeDevMediaSessionLog(listener: Listener): () => void {
  listeners.add(listener)
  listener(getDevMediaSessionLog())
  return () => {
    listeners.delete(listener)
  }
}
