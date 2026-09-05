export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

/** Семантические действия. Направления к ним привязываются через gestureConfig. */
export type GestureAction = 'categorize' | 'like' | 'skip' | 'previous'

export type GestureConfig = Record<SwipeDirection, GestureAction>
