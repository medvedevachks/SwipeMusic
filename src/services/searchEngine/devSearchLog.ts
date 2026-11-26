/**
 * Dev-only журнал шагов SearchEngine.
 * Не влияет на прод-сборку (noop вне import.meta.env.DEV).
 */

export type DevSearchLogStage =
  | 'started'
  | 'provider'
  | 'request'
  | 'http'
  | 'tracks'
  | 'mapped'
  | 'merged'
  | 'ui'
  | 'skip'
  | 'error'

export type DevSearchLogEntry = {
  id: string
  at: number
  stage: DevSearchLogStage
  message: string
  providerId?: string
  detail?: string
}

type Listener = (entries: DevSearchLogEntry[]) => void

const MAX_ENTRIES = 200

let entries: DevSearchLogEntry[] = []
const listeners = new Set<Listener>()
let seq = 0

function isDevMode(): boolean {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch {
    return false
  }
}

function notify(): void {
  const snapshot = [...entries]
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function pushDevSearchLog(
  input: Omit<DevSearchLogEntry, 'id' | 'at'> & { at?: number },
): void {
  if (!isDevMode()) {
    return
  }
  seq += 1
  entries = [
    ...entries,
    {
      id: `search-log-${seq}`,
      at: input.at ?? performance.now(),
      stage: input.stage,
      message: input.message,
      providerId: input.providerId,
      detail: input.detail,
    },
  ].slice(-MAX_ENTRIES)
  notify()
}

export function clearDevSearchLog(): void {
  if (!isDevMode()) {
    return
  }
  entries = []
  notify()
}

export function getDevSearchLog(): DevSearchLogEntry[] {
  return [...entries]
}

export function subscribeDevSearchLog(listener: Listener): () => void {
  listeners.add(listener)
  listener(getDevSearchLog())
  return () => {
    listeners.delete(listener)
  }
}

export function beginDevSearchSession(query: string): void {
  if (!isDevMode()) {
    return
  }
  clearDevSearchLog()
  pushDevSearchLog({
    stage: 'started',
    message: `Search started`,
    detail: query,
  })
}
