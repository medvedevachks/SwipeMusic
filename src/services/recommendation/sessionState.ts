import type { RecommendationEmptyReason, RecommendationMode } from './types.ts'

/** Активный рекомендательный режим (не album/playlist). */
export type ActiveRecommendationMode = RecommendationMode | 'search'

export type RecommendationMissInfo = {
  soft: boolean
  emptyReason: RecommendationEmptyReason
  message: string
}

let activeMode: ActiveRecommendationMode | null = null
/** Сессия дошла до hard miss: карточка остаётся на последнем треке, browse hits не подставляются. */
let recommendationExhausted = false
/** Последний miss advance (soft = можно повторить без permanent exhausted). */
let lastMiss: RecommendationMissInfo | null = null

const SOFT_MISS_REASONS: ReadonlySet<RecommendationEmptyReason> = new Set([
  'timeout',
  'error',
  'aborted',
  'no-candidates',
  'all-unavailable',
])

export function getActiveRecommendationMode(): ActiveRecommendationMode | null {
  return activeMode
}

export function setActiveRecommendationMode(mode: ActiveRecommendationMode | null): void {
  activeMode = mode
  if (mode !== null) {
    recommendationExhausted = false
    lastMiss = null
  }
}

export function markRecommendationExhausted(): void {
  recommendationExhausted = true
}

export function clearRecommendationExhausted(): void {
  recommendationExhausted = false
}

export function isRecommendationExhausted(): boolean {
  return recommendationExhausted
}

export function noteRecommendationMiss(
  emptyReason: RecommendationEmptyReason,
  message: string,
): RecommendationMissInfo {
  const soft = SOFT_MISS_REASONS.has(emptyReason) && emptyReason !== 'no-sources'
  // no-sources — hard: без источников поток невозможен.
  const hard = emptyReason === 'no-sources'
  lastMiss = {
    soft: soft && !hard,
    emptyReason,
    message,
  }
  return lastMiss
}

export function takeRecommendationMiss(): RecommendationMissInfo | null {
  const value = lastMiss
  lastMiss = null
  return value
}

export function peekRecommendationMiss(): RecommendationMissInfo | null {
  return lastMiss
}

export function clearRecommendationMiss(): void {
  lastMiss = null
}

export function resetRecommendationSessionStateForTests(): void {
  activeMode = null
  recommendationExhausted = false
  lastMiss = null
}
