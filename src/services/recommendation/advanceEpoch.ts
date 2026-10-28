/**
 * Поколение recommendation advance: Previous / новый seed инвалидируют inflight Next.
 * Отдельный модуль без зависимостей — без циклов sessionRuntime ↔ continuation.
 */

let advanceEpoch = 0

export function invalidateRecommendationAdvance(): void {
  advanceEpoch += 1
}

export function getRecommendationAdvanceEpoch(): number {
  return advanceEpoch
}

export function resetRecommendationAdvanceEpochForTests(): void {
  advanceEpoch = 0
}
