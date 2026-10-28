import type { RecommendationMode } from './types.ts'

/** Активный рекомендательный режим (не album/playlist). */
export type ActiveRecommendationMode = RecommendationMode | 'search'

let activeMode: ActiveRecommendationMode | null = null
/** Сессия дошла до miss: карточка остаётся на последнем треке, browse hits не подставляются. */
let recommendationExhausted = false

export function getActiveRecommendationMode(): ActiveRecommendationMode | null {
  return activeMode
}

export function setActiveRecommendationMode(mode: ActiveRecommendationMode | null): void {
  activeMode = mode
  if (mode !== null) {
    recommendationExhausted = false
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

export function resetRecommendationSessionStateForTests(): void {
  activeMode = null
  recommendationExhausted = false
}
