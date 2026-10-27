import { useCallback, useRef, useState, type PointerEvent } from 'react'
import { formatPlaybackTime } from '../../utils/formatTime'

type PlayerProgressBarProps = {
  currentTime: number
  duration: number
  disabled?: boolean
  onSeek: (timeSeconds: number) => void
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Прогресс с кликом и drag. Во время перетаскивания показывает preview-время.
 */
export default function PlayerProgressBar({
  currentTime,
  duration,
  disabled = false,
  onSeek,
}: PlayerProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)

  const ratio =
    previewRatio ??
    (duration > 0 ? clamp01(currentTime / duration) : 0)
  const displayTime =
    previewRatio != null && duration > 0
      ? previewRatio * duration
      : currentTime

  const ratioFromPointer = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) {
      return 0
    }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) {
      return 0
    }
    return clamp01((clientX - rect.left) / rect.width)
  }, [])

  const commitSeek = useCallback(
    (nextRatio: number) => {
      if (disabled || duration <= 0) {
        return
      }
      onSeek(nextRatio * duration)
    },
    [disabled, duration, onSeek],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = ratioFromPointer(event.clientX)
    setDragging(true)
    setPreviewRatio(next)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return
    }
    setPreviewRatio(ratioFromPointer(event.clientX))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return
    }
    const next = ratioFromPointer(event.clientX)
    setDragging(false)
    setPreviewRatio(null)
    commitSeek(next)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // already released
    }
  }

  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-muted)] sm:text-[11px]">
        {formatPlaybackTime(displayTime)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Позиция воспроизведения"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(duration))}
        aria-valuenow={Math.floor(displayTime)}
        aria-disabled={disabled}
        className={[
          'group relative h-8 flex-1 cursor-pointer touch-none',
          disabled ? 'pointer-events-none opacity-40' : '',
        ].join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDragging(false)
          setPreviewRatio(null)
        }}
        onKeyDown={(event) => {
          if (disabled || duration <= 0) {
            return
          }
          const step = event.shiftKey ? 10 : 5
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            onSeek(Math.min(duration, currentTime + step))
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            onSeek(Math.max(0, currentTime - step))
          }
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-border)] transition-[height] group-hover:h-1.5">
          <div
            className="h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div
          className={[
            'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-player-fg)] shadow transition-opacity',
            dragging || previewRatio != null
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100',
          ].join(' ')}
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      <span className="w-10 shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-muted)] sm:text-[11px]">
        {formatPlaybackTime(duration)}
      </span>
    </div>
  )
}
