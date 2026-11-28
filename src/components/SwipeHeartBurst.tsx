import type { SwipeHeartPhase } from './swipeHeartVisual'
import { SWIPE_HEART_SIZE_PX } from './swipeHeartVisual'

type SwipeHeartBurstProps = {
  phase: SwipeHeartPhase
  token: number
  className?: string
  onFlyEnd?: (token: number) => void
}

/**
 * Large red heart overlay — same CSS/keyframes as SwipeDeck
 * (`.swipe-heart` / `.swipe-heart-fly` / `.swipe-heart-rest`).
 * pointer-events: none via CSS; does not block playback or gestures.
 */
export function SwipeHeartBurst({
  phase,
  token,
  className,
  onFlyEnd,
}: SwipeHeartBurstProps) {
  return (
    <div
      className={[
        'swipe-heart absolute left-1/2 z-30',
        phase === 'fly' ? 'swipe-heart-fly' : 'swipe-heart-rest',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-heart={phase}
      data-heart-size={String(SWIPE_HEART_SIZE_PX)}
      data-testid="swipe-heart-burst"
      onAnimationEnd={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.animationName !== 'swipe-heart-fly'
        ) {
          return
        }
        onFlyEnd?.(token)
      }}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true" className="h-full w-full">
        <path
          d="M60 96.5S28.2 76 16.4 56.6C8.6 43.8 12.8 27 28.2 21.4c9.8-3.6 19.2-1 25.4 7.2 1.8 2.4 6.2 2.4 8 0 6.2-8.2 15.6-10.8 25.4-7.2C103.2 27 107.4 43.8 99.6 56.6 87.8 76 60 96.5 60 96.5z"
          fill="#e11d48"
          stroke="#e11d48"
          strokeWidth="6"
        />
      </svg>
    </div>
  )
}
