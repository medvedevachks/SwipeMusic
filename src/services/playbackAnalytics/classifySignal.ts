import { PLAYBACK_ANALYTICS_LIMITS } from './types.ts'

/**
 * Отдельная классификация сырого прослушивания.
 * Ранний пропуск сюда попадает как early-skip и не является дизлайком.
 */
export type TasteSignal = 'none' | 'listened' | 'completed' | 'early-skip' | 'skip'

export function classifyPlaybackSignal(input: {
  durationMs: number | null
  listenedMs: number
  completed: boolean
  skipped: boolean
  failed: boolean
}): TasteSignal {
  if (input.failed) {
    return 'none'
  }
  if (input.completed) {
    return 'completed'
  }
  const listened = Math.max(0, input.listenedMs)
  const duration = input.durationMs && input.durationMs > 0 ? input.durationMs : null
  const ratio = duration ? listened / duration : 0
  if (listened < PLAYBACK_ANALYTICS_LIMITS.earlySkipMs) {
    return 'none'
  }
  if (input.skipped && (duration == null || ratio < PLAYBACK_ANALYTICS_LIMITS.earlySkipRatio)) {
    return 'early-skip'
  }
  if (input.skipped) {
    return 'skip'
  }
  if (listened >= PLAYBACK_ANALYTICS_LIMITS.heardMs || ratio >= PLAYBACK_ANALYTICS_LIMITS.heardRatio) {
    return 'listened'
  }
  return 'none'
}

export function summarizePlaybackEvents(events: readonly {
  sessionId: string
  eventType: string
  listenedMs: number
}[]): {
  playCount: number
  completedCount: number
  skippedCount: number
  listenedMs: number
} {
  let playCount = 0
  let completedCount = 0
  let skippedCount = 0
  const listenedBySession = new Map<string, number>()
  for (const event of events) {
    if (event.eventType === 'playback_started') {
      playCount += 1
    } else if (event.eventType === 'playback_completed') {
      completedCount += 1
    } else if (event.eventType === 'playback_skipped') {
      skippedCount += 1
    }
    const previous = listenedBySession.get(event.sessionId) ?? 0
    if (event.listenedMs > previous) {
      listenedBySession.set(event.sessionId, event.listenedMs)
    }
  }
  let listenedMs = 0
  for (const value of listenedBySession.values()) {
    listenedMs += value
  }
  return { playCount, completedCount, skippedCount, listenedMs }
}
