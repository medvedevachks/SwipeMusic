import type { GestureAction, GestureConfig, SwipeDirection } from './gesture'

/** @deprecated Используйте GestureAction / gestureConfig */
export type SwipeAction = GestureAction

/** @deprecated */
export type SwipeDecision = {
  trackId: string
  action: GestureAction
  direction?: SwipeDirection
}

export type { GestureAction, GestureConfig, SwipeDirection }
