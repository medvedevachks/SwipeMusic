/**
 * Решение после await load/play: трогать ли shared adapter.
 * Устаревшее поколение / abort — только выход, без pause (иначе глушит актуальный B).
 */
export type StalePlaySettlement = 'proceed' | 'abandon-silent'

export function settlePlayGeneration(input: {
  attemptGeneration: number
  currentPlayGeneration: number
  /** after-await: проверка после load/play; on-error: ветка catch. */
  phase: 'after-await' | 'on-error'
  isAbortError?: boolean
}): StalePlaySettlement {
  if (input.attemptGeneration !== input.currentPlayGeneration) {
    return 'abandon-silent'
  }
  if (input.phase === 'on-error' && input.isAbortError) {
    return 'abandon-silent'
  }
  return 'proceed'
}
