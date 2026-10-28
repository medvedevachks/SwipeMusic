import type { SearchSeedPlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'

/** Отмена устаревшего prepare. Провайдер обязан проверять aborted. */
export type ContinuationSignal = {
  readonly generation: number
  aborted: boolean
}

export type ContinuationCandidate = {
  track: Track
}

/**
 * Точка подключения единого Recommendation Engine
 * (`src/services/recommendation`, createRecommendationContinuationProvider).
 * Runtime search-seed пока использует libraryContinuation provider.
 */
export interface ContinuationProvider {
  prepareContinuation(
    currentTrack: Track,
    context: SearchSeedPlaybackContext,
    signal: ContinuationSignal,
  ): Promise<ContinuationCandidate | null>
}

/** Кандидат можно поставить следующим: есть источник, это не текущий и не дубль очереди. */
export function isContinuationCandidateAvailable(
  track: Track | null | undefined,
  currentTrackId: string,
  queueItems: readonly Track[],
): boolean {
  if (!track?.id || !track.sourceId) {
    return false
  }
  if (track.id === currentTrackId) {
    return false
  }
  return !queueItems.some((item) => item.id === track.id)
}
