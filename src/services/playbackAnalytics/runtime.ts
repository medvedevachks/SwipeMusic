import { useAuthStore } from '../../store/authStore.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { PlaybackOutbox } from './outbox.ts'
import { PlaybackAnalyticsMachine } from './sessionMachine.ts'
import type { AnalyticsCommand, PlaybackEvent, TrackIdentityRef } from './types.ts'

export type PlaybackSendResult = 'ok' | 'offline' | 'reject' | 'stale'

export type PlaybackAnalyticsRuntime = {
  ingest(command: AnalyticsCommand): void
  flush(): Promise<void>
  syncOwner(): void
}

const FLUSH_LIMIT = 40

export function createPlaybackAnalyticsRuntime(options: {
  now: () => string
  newId: () => string
  userId: () => string | null
  canonicalId: (sourceId: string, externalId: string) => string | null
  transport: (
    userId: string,
    events: PlaybackEvent[],
    signal: AbortSignal,
  ) => Promise<PlaybackSendResult>
  outbox?: PlaybackOutbox
}): PlaybackAnalyticsRuntime {
  const machine = new PlaybackAnalyticsMachine(options.now, options.newId)
  const outbox = options.outbox ?? new PlaybackOutbox()
  let flushing = false
  let followUp = false
  let boundUser: string | null | undefined
  let epoch = 0
  let activeController: AbortController | null = null

  function adopt(userId: string | null): void {
    if (boundUser === userId) {
      return
    }
    if (boundUser !== undefined) {
      machine.reset()
      epoch += 1
      activeController?.abort()
    }
    boundUser = userId
  }

  async function flush(): Promise<void> {
    if (flushing) {
      followUp = true
      return
    }
    const owner = options.userId()
    adopt(owner)
    if (!owner) {
      return
    }
    const batch = outbox.peek(owner, FLUSH_LIMIT)
    if (batch.length === 0) {
      return
    }
    const capturedEpoch = epoch
    const controller = new AbortController()
    activeController = controller
    flushing = true
    try {
      if (options.userId() !== owner || epoch !== capturedEpoch || controller.signal.aborted) {
        return
      }
      const result = await options.transport(owner, batch, controller.signal)
      if (
        options.userId() !== owner
        || epoch !== capturedEpoch
        || controller.signal.aborted
        || result === 'offline'
        || result === 'stale'
      ) {
        return
      }
      outbox.ack(owner, batch.map((event) => event.eventId))
    } catch {
      // Сеть или транспорт не останавливают плеер. События остаются у владельца.
    } finally {
      flushing = false
      if (activeController === controller) {
        activeController = null
      }
      const switched = epoch !== capturedEpoch || options.userId() !== owner
      const again = followUp || switched
      followUp = false
      if (again) {
        queueMicrotask(() => {
          void flush()
        })
      }
    }
  }

  return {
    syncOwner() {
      adopt(options.userId())
    },
    ingest(command) {
      const userId = options.userId()
      adopt(userId)
      if (!userId) {
        return
      }
      const events = machine.apply(attachCanonical(command, options.canonicalId))
      if (events.length === 0) {
        return
      }
      outbox.append(userId, events)
    },
    flush,
  }
}

function attachCanonical(
  command: AnalyticsCommand,
  canonicalId: (sourceId: string, externalId: string) => string | null,
): AnalyticsCommand {
  if (!('sourceId' in command) || command.canonicalTrackId) {
    return command
  }
  const resolved = canonicalId(command.sourceId, command.externalId)
  if (!resolved) {
    return command
  }
  return { ...command, canonicalTrackId: resolved }
}

function knownCanonicalId(sourceId: string, externalId: string): string | null {
  const key = `${sourceId}:${externalId}`
  return useCanonicalLibraryStore.getState().sourceKeyToCanonicalId[key] ?? null
}

let runtime: PlaybackAnalyticsRuntime | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function getPlaybackAnalytics(): PlaybackAnalyticsRuntime {
  if (!runtime) {
    runtime = createPlaybackAnalyticsRuntime({
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      userId: () => useAuthStore.getState().user?.id ?? null,
      canonicalId: knownCanonicalId,
      transport: postPlaybackEvents,
    })
    useAuthStore.subscribe((state, previous) => {
      if (state.user?.id === previous.user?.id) {
        return
      }
      const analytics = runtime
      if (!analytics) {
        return
      }
      analytics.syncOwner()
      if (state.user?.id) {
        scheduleFlush(analytics)
      }
    })
  }
  return runtime
}

export function ingestPlaybackAnalytics(command: AnalyticsCommand): void {
  try {
    const analytics = getPlaybackAnalytics()
    analytics.ingest(command)
    scheduleFlush(analytics)
  } catch {
    // Статистика не влияет на воспроизведение.
  }
}

function scheduleFlush(analytics: PlaybackAnalyticsRuntime): void {
  if (flushTimer) {
    return
  }
  flushTimer = setTimeout(() => {
    flushTimer = null
    void analytics.flush()
  }, 500)
}

async function postPlaybackEvents(
  userId: string,
  events: PlaybackEvent[],
  signal: AbortSignal,
): Promise<PlaybackSendResult> {
  if (signal.aborted || useAuthStore.getState().user?.id !== userId) {
    return 'stale'
  }
  try {
    const response = await fetch('/api/me/playback-events', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: events.map(publicEvent) }),
    })
    if (signal.aborted || useAuthStore.getState().user?.id !== userId) {
      return 'stale'
    }
    if (response.status === 400) {
      return 'reject'
    }
    if (!response.ok) {
      return 'offline'
    }
    return 'ok'
  } catch {
    return signal.aborted ? 'stale' : 'offline'
  }
}

function publicEvent(event: PlaybackEvent): PlaybackEvent {
  const identity: TrackIdentityRef = {
    sourceId: event.sourceId,
    externalId: event.externalId,
    canonicalTrackId: event.canonicalTrackId,
  }
  return {
    eventId: event.eventId,
    sessionId: event.sessionId,
    eventType: event.eventType,
    sourceId: identity.sourceId,
    externalId: identity.externalId,
    canonicalTrackId: identity.canonicalTrackId,
    positionMs: event.positionMs,
    listenedMs: event.listenedMs,
    durationMs: event.durationMs,
    reason: event.reason,
    createdAt: event.createdAt,
  }
}

export function resetPlaybackAnalyticsForTests(): void {
  runtime = null
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
