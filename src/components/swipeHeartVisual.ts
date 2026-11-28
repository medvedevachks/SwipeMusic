/** Visual policy for the shared SwipeDeck / FullscreenPlayer like heart. */

export type SwipeHeartPhase = 'fly' | 'rest'

/** Matches `.swipe-heart` (9.5rem) and SwipeDeck `data-heart-size`. */
export const SWIPE_HEART_SIZE_PX = 152

/** Dismiss timer for fly phase (animation ~980ms + buffer). */
export const SWIPE_HEART_DISMISS_MS = 1100

export function resolveSwipeHeartPhase(reduceMotion: boolean): SwipeHeartPhase {
  return reduceMotion ? 'rest' : 'fly'
}

/** Heart only after confirmed save in the same auth session. */
export function shouldShowSwipeHeart(input: {
  savedOk: boolean
  authCurrent: boolean
}): boolean {
  return input.savedOk === true && input.authCurrent
}

export function prefersReducedMotion(
  matchMedia: ((query: string) => MediaQueryList) | undefined = globalThis.matchMedia,
): boolean {
  return Boolean(matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
}
