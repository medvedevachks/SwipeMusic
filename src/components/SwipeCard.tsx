import { animated } from '@react-spring/web'
import type { SpringValue } from '@react-spring/web'
import { gestureActionLabels } from '../config/gestureConfig'
import type { SwipeAction } from '../types/swipe'
import type { Track } from '../types/track'

type SwipeCardProps = {
  track: Track
  x: SpringValue<number>
  y: SpringValue<number>
  rot: SpringValue<number>
  scale: SpringValue<number>
  opacity?: SpringValue<number>
  bind?: () => Record<string, unknown>
  interactive?: boolean
  hintAction?: SwipeAction | null
  zIndex?: number
}

const hintStyles: Record<SwipeAction, string> = {
  categorize: 'border-teal-500 text-teal-700 bg-teal-500/15',
  like: 'border-rose-500 text-rose-600 bg-rose-500/15',
  skip: 'border-sky-500 text-sky-700 bg-sky-500/15',
  previous: 'border-amber-500 text-amber-700 bg-amber-500/15',
}

export default function SwipeCard({
  track,
  x,
  y,
  rot,
  scale,
  opacity,
  bind,
  interactive = false,
  hintAction = null,
  zIndex = 1,
}: SwipeCardProps) {
  return (
    <animated.article
      {...(interactive && bind ? bind() : {})}
      className={`absolute inset-0 touch-none select-none will-change-transform ${
        interactive ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'
      }`}
      style={{
        x,
        y,
        rotateZ: rot,
        scale,
        opacity,
        zIndex,
      }}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_18px_50px_-28px_rgba(20,33,43,0.55)]">
        <div
          className="relative min-h-0 flex-1 bg-[var(--color-accent)]"
          style={{
            backgroundColor: track.coverColor ?? undefined,
            backgroundImage: track.coverUrl ? `url(${track.coverUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/35" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_45%)]" />

          {interactive && hintAction && (
            <div
              className={`absolute left-1/2 top-6 -translate-x-1/2 rounded-xl border-2 px-4 py-1.5 text-sm font-bold uppercase tracking-wider backdrop-blur-sm ${hintStyles[hintAction]}`}
            >
              {gestureActionLabels[hintAction]}
            </div>
          )}
        </div>

        <div className="space-y-1 px-5 py-4">
          <h2 className="truncate text-xl font-semibold tracking-tight text-[var(--color-fg)]">
            {track.title}
          </h2>
          <p className="truncate text-sm text-[var(--color-muted)]">
            {track.artist}
          </p>
        </div>
      </div>
    </animated.article>
  )
}
