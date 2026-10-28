/**
 * DEV-only цепочка Next / search-seed.
 * Без токенов, cookies, email, паролей и дампа библиотеки.
 */

import type { PlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'

export type SearchFlowDiagNextSource =
  | 'search-result'
  | 'continuation'
  | 'queue'
  | 'unknown'
  | null

export type SearchFlowDiagEvent = {
  seq: number
  at: string
  source: string
  commandId: string | null
  contextBefore: string | null
  contextAfter: string | null
  queueLengthBefore: number | null
  queueLengthAfter: number | null
  currentIndex: number | null
  trackId: string | null
  nextSource: SearchFlowDiagNextSource
  detail?: string
}

type QueueSnap = {
  contextType: string
  queueLength: number
  currentIndex: number
  currentTrackId: string | null
  peekNextId: string | null
}

type DiagWindow = Window & {
  __swipeSearchFlowDiag?: {
    events: () => readonly SearchFlowDiagEvent[]
    clear: () => void
    snapshot: () => QueueSnap & { commandId: string | null; seq: number }
  }
}

const MAX_EVENTS = 80
const events: SearchFlowDiagEvent[] = []
let seq = 0
let activeCommandId: string | null = null
let commandSeq = 0
let lastContextType: string | null = null

function isDevDiagEnabled(): boolean {
  try {
    return import.meta.env.DEV === true
  } catch {
    return false
  }
}

/** Короткий анонимный id: source + усечённый hash, без title/artist. */
export function anonymizeTrackId(trackId: string | null | undefined): string | null {
  if (!trackId) {
    return null
  }
  let hash = 0
  for (let i = 0; i < trackId.length; i += 1) {
    hash = (hash * 31 + trackId.charCodeAt(i)) >>> 0
  }
  const hex = hash.toString(16).padStart(8, '0')
  const colon = trackId.indexOf(':')
  const source = colon > 0 ? trackId.slice(0, colon) : 'track'
  return `${source}:${hex}`
}

export function beginSearchFlowCommand(source: string): string {
  if (!isDevDiagEnabled()) {
    return 'off'
  }
  commandSeq += 1
  activeCommandId = `cmd-${commandSeq}`
  noteSearchFlowEvent({
    source,
    detail: 'user-command-begin',
  })
  return activeCommandId
}

export function getActiveSearchFlowCommandId(): string | null {
  return activeCommandId
}

export function noteSearchFlowEvent(input: {
  source: string
  contextBefore?: string | null
  contextAfter?: string | null
  queueLengthBefore?: number | null
  queueLengthAfter?: number | null
  currentIndex?: number | null
  trackId?: string | null
  nextSource?: SearchFlowDiagNextSource
  detail?: string
  commandId?: string | null
}): void {
  if (!isDevDiagEnabled()) {
    return
  }
  seq += 1
  const event: SearchFlowDiagEvent = {
    seq,
    at: new Date().toISOString(),
    source: input.source,
    commandId: input.commandId ?? activeCommandId,
    contextBefore: input.contextBefore ?? null,
    contextAfter: input.contextAfter ?? null,
    queueLengthBefore: input.queueLengthBefore ?? null,
    queueLengthAfter: input.queueLengthAfter ?? null,
    currentIndex: input.currentIndex ?? null,
    trackId: anonymizeTrackId(input.trackId),
    nextSource: input.nextSource ?? null,
    detail: input.detail,
  }
  events.push(event)
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }
  if (typeof input.contextAfter === 'string' && input.contextAfter !== lastContextType) {
    lastContextType = input.contextAfter
  }
}

export function noteContextChange(input: {
  source: string
  before: PlaybackContext['type'] | string
  after: PlaybackContext['type'] | string
  queueLength: number
  currentIndex: number
  trackId?: string | null
}): void {
  if (input.before === input.after) {
    return
  }
  noteSearchFlowEvent({
    source: input.source,
    contextBefore: String(input.before),
    contextAfter: String(input.after),
    queueLengthBefore: input.queueLength,
    queueLengthAfter: input.queueLength,
    currentIndex: input.currentIndex,
    trackId: input.trackId,
    detail: 'context-change',
  })
}

export function queueProbe(queue: {
  getSnapshot: () => {
    context: { type: string }
    items: readonly unknown[]
    currentIndex: number
  }
  current: () => Track | null
  peekNext: () => Track | null
}): QueueSnap {
  const snapshot = queue.getSnapshot()
  return {
    contextType: snapshot.context.type,
    queueLength: snapshot.items.length,
    currentIndex: snapshot.currentIndex,
    currentTrackId: queue.current()?.id ?? null,
    peekNextId: queue.peekNext()?.id ?? null,
  }
}

export function getSearchFlowDiagEvents(): readonly SearchFlowDiagEvent[] {
  return events
}

export function clearSearchFlowDiagEvents(): void {
  events.length = 0
  seq = 0
  activeCommandId = null
  commandSeq = 0
  lastContextType = null
}

export function installSearchFlowDiagBridge(readLive: () => QueueSnap): void {
  if (typeof window === 'undefined' || !isDevDiagEnabled()) {
    return
  }
  const target = window as DiagWindow
  target.__swipeSearchFlowDiag = {
    events: () => getSearchFlowDiagEvents(),
    clear: () => clearSearchFlowDiagEvents(),
    snapshot: () => ({
      ...readLive(),
      commandId: activeCommandId,
      seq,
    }),
  }
}
