import { defaultGestureConfig } from '../../config/gestureConfig'
import type { GestureConfig, SwipeDirection } from '../../types/gesture'
import type { SwipeAction, SwipeDecision } from '../../types/swipe'
import type { Track } from '../../types/track'

export type ResolveSwipeInput = {
  track: Track
  direction: SwipeDirection
  gestureConfig?: GestureConfig
  /** Индекс текущей карточки в колоде (для previous). */
  deckIndex?: number
  /**
   * Явный доступ Previous (playback history / peekPrevious).
   * Если задан — важнее deckIndex (sync-колода после exhausted).
   */
  canGoPrevious?: boolean
}

/**
 * Чистый swipe engine: направление + конфиг → семантическое действие.
 * UI только отображает результат и запускает анимации.
 */
export function resolveSwipeAction(input: ResolveSwipeInput): SwipeDecision {
  const config = input.gestureConfig ?? defaultGestureConfig
  const action: SwipeAction = config[input.direction]
  const deckIndex = input.deckIndex ?? 0
  const canGoPrevious =
    action !== 'previous'
      ? true
      : input.canGoPrevious !== undefined
        ? input.canGoPrevious
        : deckIndex > 0

  return {
    track: input.track,
    action,
    direction: input.direction,
    requiresCategorySelection: action === 'categorize',
    canGoPrevious,
  }
}

export function getSwipeActionForDirection(
  direction: SwipeDirection,
  config: GestureConfig = defaultGestureConfig,
): SwipeAction {
  return config[direction]
}
