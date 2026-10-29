import { gestureActionLabels } from '../config/gestureConfig'
import type { GestureConfig, SwipeDirection } from '../types/gesture'
import type { SwipeAction } from '../types/swipe'

type SwipeDirectionHintsProps = {
  gestureConfig: GestureConfig
  /** Dominant direction во время drag (null = нет активного жеста). */
  activeDirection: SwipeDirection | null
  /** 0–1 visual progress к commit threshold. */
  progress: number
}

const DIRECTION_ORDER: SwipeDirection[] = ['up', 'left', 'right', 'down']

/** Ячейки CSS grid колоды — не absolute поверх карточки. */
const areaClass: Record<SwipeDirection, string> = {
  up: 'swipe-hint swipe-hint-up',
  down: 'swipe-hint swipe-hint-down',
  left: 'swipe-hint swipe-hint-left',
  right: 'swipe-hint swipe-hint-right',
}

const arrowPrefix: Record<SwipeDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

const accentByAction: Record<SwipeAction, string> = {
  categorize: 'text-teal-700 dark:text-teal-300',
  like: 'text-rose-700 dark:text-rose-300',
  skip: 'text-sky-700 dark:text-sky-300',
  previous: 'text-amber-700 dark:text-amber-300',
}

/**
 * Постоянные подсказки направлений вокруг колоды.
 * Не кнопки — только direction hints.
 */
export function SwipeDirectionHints({
  gestureConfig,
  activeDirection,
  progress,
}: SwipeDirectionHintsProps) {
  return (
    <>
      {DIRECTION_ORDER.map((direction) => {
        const action = gestureConfig[direction]
        const label = gestureActionLabels[action]
        const isActive = activeDirection === direction
        const ready = isActive && progress >= 1
        const opacity = isActive
          ? 0.55 + Math.min(progress, 1) * 0.45
          : 0.88

        return (
          <div
            key={direction}
            className={areaClass[direction]}
            style={{ opacity }}
            aria-hidden="true"
          >
            <p
              className={[
                'text-[11px] font-semibold leading-tight tracking-wide sm:text-[12px]',
                isActive
                  ? accentByAction[action]
                  : 'text-[var(--color-fg)]',
                ready ? 'scale-105' : '',
              ].join(' ')}
            >
              <span className="block text-[13px] leading-none sm:text-[14px]">
                {arrowPrefix[direction]}
              </span>
              <span className="mt-0.5 block break-words hyphens-auto text-[var(--color-muted)]">
                {isActive ? (
                  <span className={accentByAction[action]}>{label}</span>
                ) : (
                  label
                )}
              </span>
            </p>
          </div>
        )
      })}
    </>
  )
}
