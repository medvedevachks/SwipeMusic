import type { SwipeAction } from './swipe'

export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

/** @deprecated Используйте SwipeAction — направление ≠ действие. */
export type GestureAction = SwipeAction

/** Привязка направления жеста к семантическому действию. */
export type GestureConfig = Record<SwipeDirection, SwipeAction>
