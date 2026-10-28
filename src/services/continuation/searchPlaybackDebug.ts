/**
 * Безопасная диагностика search-seed без токенов, email и содержимого библиотеки.
 * DEV всегда; в production — только если window.__SWIPE_SEARCH_DEBUG__ === true.
 */

export type SearchPlaybackDebugEvent = {
  at: string
  kind: string
  contextType?: string
  queueLength?: number
  trackId?: string | null
  reason?: string
  source?: string
  seedEnabled?: boolean
  buildFlag?: string | null
}

type DebugWindow = Window & {
  __SWIPE_SEARCH_DEBUG__?: boolean
  __swipeSearchDebug?: {
    snapshot: () => SearchPlaybackDebugSnapshot
    events: () => readonly SearchPlaybackDebugEvent[]
  }
}

export type SearchPlaybackDebugSnapshot = {
  enabled: boolean
  seedPlaybackEnabled: boolean
  buildFlag: string | null
  production: boolean
  contextType: string | null
  queueLength: number | null
  lastEvent: SearchPlaybackDebugEvent | null
}

const MAX_EVENTS = 40
const events: SearchPlaybackDebugEvent[] = []

function readBuildFlag(): string | null {
  try {
    const value = import.meta.env.VITE_SEARCH_SEED_PLAYBACK
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function isProductionBuild(): boolean {
  try {
    return import.meta.env.PROD === true
  } catch {
    return false
  }
}

export function isSearchPlaybackDebugEnabled(): boolean {
  try {
    if (import.meta.env.DEV === true) {
      return true
    }
  } catch {
    // node tests
  }
  try {
    if (typeof window === 'undefined') {
      return false
    }
    return (window as DebugWindow).__SWIPE_SEARCH_DEBUG__ === true
  } catch {
    return false
  }
}

export function noteSearchPlaybackEvent(
  kind: string,
  details: Omit<SearchPlaybackDebugEvent, 'at' | 'kind'> = {},
): void {
  if (!isSearchPlaybackDebugEnabled()) {
    return
  }
  events.push({
    at: new Date().toISOString(),
    kind,
    buildFlag: readBuildFlag(),
    ...details,
  })
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }
}

export function getSearchPlaybackDebugEvents(): readonly SearchPlaybackDebugEvent[] {
  return events
}

export function getSearchPlaybackDebugSnapshot(input?: {
  contextType?: string | null
  queueLength?: number | null
  seedPlaybackEnabled?: boolean
}): SearchPlaybackDebugSnapshot {
  return {
    enabled: isSearchPlaybackDebugEnabled(),
    seedPlaybackEnabled: input?.seedPlaybackEnabled ?? false,
    buildFlag: readBuildFlag(),
    production: isProductionBuild(),
    contextType: input?.contextType ?? null,
    queueLength: input?.queueLength ?? null,
    lastEvent: events[events.length - 1] ?? null,
  }
}

/**
 * Вешает window.__swipeSearchDebug только когда диагностика уже разрешена
 * (Vite DEV или заранее выставленный __SWIPE_SEARCH_DEBUG__).
 * Штатный production bootstrap этот мост не ставит.
 */
export function installSearchPlaybackDebugBridge(readLive: () => {
  contextType: string | null
  queueLength: number
  seedPlaybackEnabled: boolean
}): void {
  if (typeof window === 'undefined' || !isSearchPlaybackDebugEnabled()) {
    return
  }
  const target = window as DebugWindow
  target.__swipeSearchDebug = {
    snapshot: () => {
      const live = readLive()
      return getSearchPlaybackDebugSnapshot({
        contextType: live.contextType,
        queueLength: live.queueLength,
        seedPlaybackEnabled: live.seedPlaybackEnabled,
      })
    },
    events: () => getSearchPlaybackDebugEvents(),
  }
}
