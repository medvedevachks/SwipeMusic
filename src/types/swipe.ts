import type { SwipeDirection } from './gesture'
import type { Track } from './track'

/**
 * Семантическое действие свайпа.
 * Направление жеста ≠ действие: маппинг задаётся через GestureConfig.
 */
export type SwipeAction = 'categorize' | 'like' | 'skip' | 'previous'

/** Результат решения swipe engine по одному жесту. */
export type SwipeDecision = {
  track: Track
  action: SwipeAction
  direction: SwipeDirection
  /** UI должен дождаться выбора категории перед переходом дальше. */
  requiresCategorySelection: boolean
  /** Можно ли выполнить previous при текущем состоянии колоды. */
  canGoPrevious: boolean
}
