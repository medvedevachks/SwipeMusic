/** Visual policy for the shared SwipeDeck / FullscreenPlayer like heart. */

export type SwipeHeartPhase = 'fly' | 'rest'

/** Matches `.swipe-heart` (9.5rem) and SwipeDeck `data-heart-size`. */
export const SWIPE_HEART_SIZE_PX = 152

/** Dismiss timer for fly phase (animation ~980ms + buffer). */
export const SWIPE_HEART_DISMISS_MS = 1100

/** Reduced-motion / static heart hold. */
export const SWIPE_HEART_REST_DISMISS_MS = 1800

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

/**
 * Per-track like in-flight gate: blocks double-save of the same track,
 * allows other tracks / navigation / transport to proceed.
 */
export type TrackLikeInFlightGate = {
  tryBegin: (trackId: string) => boolean
  end: (trackId: string) => void
  has: (trackId: string) => boolean
}

export function createTrackLikeInFlightGate(): TrackLikeInFlightGate {
  const inflight = new Set<string>()
  return {
    tryBegin(trackId) {
      if (inflight.has(trackId)) {
        return false
      }
      inflight.add(trackId)
      return true
    },
    end(trackId) {
      inflight.delete(trackId)
    },
    has(trackId) {
      return inflight.has(trackId)
    },
  }
}

export type FullscreenLikeAsyncUi =
  | { kind: 'ignore' }
  | { kind: 'error'; notice: string }
  | {
      kind: 'success'
      notice: string
      heartPhase: SwipeHeartPhase
      dismissMs: number
    }

/**
 * Async like result → UI. Auth must be current before notice/heart.
 * Stale token / logout / track change → ignore (no setNotice/setHeart).
 */
export function resolveFullscreenLikeAsyncUi(input: {
  savedOk: boolean
  authCurrent: boolean
  trackStillCurrent: boolean
  tokenCurrent: boolean
  favoritesMode: boolean
  reduceMotion: boolean
  successNotice: string
  saveFailedMessage: string
}): FullscreenLikeAsyncUi {
  if (!input.tokenCurrent) {
    return { kind: 'ignore' }
  }
  // Auth before any notice/heart from the async result.
  if (!input.authCurrent) {
    return { kind: 'ignore' }
  }
  if (!input.favoritesMode || !input.trackStillCurrent) {
    return { kind: 'ignore' }
  }
  if (!input.savedOk) {
    return { kind: 'error', notice: input.saveFailedMessage }
  }
  const heartPhase = resolveSwipeHeartPhase(input.reduceMotion)
  return {
    kind: 'success',
    notice: input.successNotice,
    heartPhase,
    dismissMs:
      heartPhase === 'fly' ? SWIPE_HEART_DISMISS_MS : SWIPE_HEART_REST_DISMISS_MS,
  }
}

/** Rejected save promise — same auth/track/token gates as success path. */
export function resolveFullscreenLikeAsyncError(input: {
  authCurrent: boolean
  trackStillCurrent: boolean
  tokenCurrent: boolean
  favoritesMode: boolean
  saveFailedMessage: string
}): FullscreenLikeAsyncUi {
  return resolveFullscreenLikeAsyncUi({
    savedOk: false,
    authCurrent: input.authCurrent,
    trackStillCurrent: input.trackStillCurrent,
    tokenCurrent: input.tokenCurrent,
    favoritesMode: input.favoritesMode,
    reduceMotion: false,
    successNotice: '',
    saveFailedMessage: input.saveFailedMessage,
  })
}
