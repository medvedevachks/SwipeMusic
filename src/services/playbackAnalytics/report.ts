import type { AnalyticsCommand } from './types.ts'

type PlaybackAnalyticsSink = (command: AnalyticsCommand) => void

let sink: PlaybackAnalyticsSink = () => {}

export function setPlaybackAnalyticsSink(next: PlaybackAnalyticsSink): void {
  sink = next
}

/** Синхронно и безопасно: ошибка статистики не доходит до плеера. */
export function reportPlayback(command: AnalyticsCommand): void {
  try {
    sink(command)
  } catch {
    // Воспроизведение продолжается без статистики.
  }
}
