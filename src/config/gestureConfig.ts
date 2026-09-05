import type { GestureConfig, SwipeDirection } from '../types/gesture'
import type { SwipeAction } from '../types/swipe'

/** Дефолтная раскладка жестов — направление ≠ действие. */
export const defaultGestureConfig: GestureConfig = {
  right: 'categorize',
  left: 'like',
  up: 'skip',
  down: 'previous',
}

export const gestureActionLabels: Record<SwipeAction, string> = {
  categorize: 'Категория',
  like: 'Лайк',
  skip: 'Дальше',
  previous: 'Назад',
}

export function getDirectionFromMovement(
  mx: number,
  my: number,
  threshold: number,
): SwipeDirection | null {
  if (Math.abs(mx) < threshold && Math.abs(my) < threshold) {
    return null
  }

  return Math.abs(mx) >= Math.abs(my)
    ? mx > 0
      ? 'right'
      : 'left'
    : my < 0
      ? 'up'
      : 'down'
}

export function getActionForDirection(
  direction: SwipeDirection,
  config: GestureConfig = defaultGestureConfig,
): SwipeAction {
  return config[direction]
}
