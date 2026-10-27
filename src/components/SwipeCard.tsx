import { useEffect, useRef, type SyntheticEvent } from 'react'
import { animated } from '@react-spring/web'
import type { SpringValue } from '@react-spring/web'
import type { SwipeDirection } from '../types/gesture'
import { PauseIcon, PlayIcon } from './icons'
import type { Track } from '../types/track'
import { formatPlaybackTime } from '../utils/formatTime'

type PlaybackOverlay = {
  currentTime: number
  duration: number
  canSeek: boolean
  onSeek: (timeSeconds: number) => void
  error?: string | null
}

type SwipeCardProps = {
  track: Track
  sourceLabel: string
  x: SpringValue<number>
  y: SpringValue<number>
  rot: SpringValue<number>
  scale: SpringValue<number>
  opacity?: SpringValue<number>
  bind?: () => Record<string, unknown>
  interactive?: boolean
  /** Подпись overlay во время drag (например «← Лайк»). */
  dragOverlayText?: string | null
  dragDirection?: SwipeDirection | null
  /** 0–1 к commit threshold. */
  dragProgress?: number
  zIndex?: number
  playback?: PlaybackOverlay | null
  onTogglePlay?: () => void
  isPlaying?: boolean
  /** Источник этой карточки уже запрашивается, звука ещё нет. */
  isStarting?: boolean
}

/** Родной listener раньше bubble: use-gesture на карточке не должен видеть Play и ползунок. */
function shieldFromCardGesture(node: HTMLElement | null): void {
  if (!node || node.dataset.gestureShield === '1') {
    return
  }
  const stop = (event: Event) => {
    event.stopPropagation()
  }
  node.addEventListener('pointerdown', stop)
  node.addEventListener('pointermove', stop)
  node.addEventListener('pointerup', stop)
  node.dataset.gestureShield = '1'
}

const overlayTone: Record<SwipeDirection, string> = {
  right: 'border-teal-400/80 bg-teal-500/25 text-teal-50',
  left: 'border-rose-400/80 bg-rose-500/25 text-rose-50',
  up: 'border-sky-400/80 bg-sky-500/25 text-sky-50',
  down: 'border-amber-400/80 bg-amber-500/25 text-amber-50',
}

const overlayEdge: Record<SwipeDirection, string> = {
  right: 'right-3 top-1/2 -translate-y-1/2',
  left: 'left-3 top-1/2 -translate-y-1/2',
  up: 'left-1/2 top-4 -translate-x-1/2',
  down: 'bottom-4 left-1/2 -translate-x-1/2',
}

function stopSeekGesture(event: SyntheticEvent) {
  event.stopPropagation()
}

export default function SwipeCard({
  track,
  sourceLabel,
  x,
  y,
  rot,
  scale,
  opacity,
  bind,
  interactive = false,
  dragOverlayText = null,
  dragDirection = null,
  dragProgress = 0,
  zIndex = 1,
  playback = null,
  onTogglePlay,
  isPlaying = false,
  isStarting = false,
}: SwipeCardProps) {
  const progressMax = playback && playback.duration > 0 ? playback.duration : 0
  const playRef = useRef<HTMLButtonElement>(null)
  const seekRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    shieldFromCardGesture(playRef.current)
    shieldFromCardGesture(seekRef.current)
  })
  const showOverlay =
    interactive && Boolean(dragOverlayText) && Boolean(dragDirection)
  const ready = dragProgress >= 1
  const overlayOpacity = Math.min(0.35 + dragProgress * 0.65, 1)

  return (
    <animated.article
      {...(interactive && bind ? bind() : {})}
      className={`absolute inset-0 select-none will-change-transform ${
        interactive
          ? 'touch-none cursor-grab active:cursor-grabbing'
          : 'pointer-events-none'
      }`}
      style={{
        x,
        y,
        rotateZ: rot,
        scale,
        opacity,
        zIndex,
        touchAction: interactive ? 'none' : undefined,
      }}
    >
      <div className="deck-card flex h-full flex-col overflow-hidden rounded-[1.7rem]">
        <div
          className="deck-cover bg-[var(--color-accent)]"
          style={{
            backgroundColor: track.coverColor ?? undefined,
            backgroundImage: track.coverUrl
              ? `url(${track.coverUrl})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/35" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_45%)]" />

          {onTogglePlay ? (
            <button
                ref={playRef}
                type="button"
                className="deck-key deck-key-primary deck-orb"
                aria-label={isPlaying ? 'Пауза' : isStarting ? 'Запуск' : 'Слушать'}
                aria-pressed={isPlaying}
                aria-busy={isStarting || undefined}
                onPointerDown={stopSeekGesture}
                onPointerUp={stopSeekGesture}
                onClick={(event) => {
                  stopSeekGesture(event)
                  onTogglePlay()
                }}
              >
                {isPlaying ? (
                  <PauseIcon />
                ) : isStarting ? (
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                ) : (
                  <PlayIcon className="translate-x-0.5" />
                )}
              </button>
          ) : null}
          {showOverlay && dragDirection ? (
            <div
              className={`pointer-events-none absolute z-10 rounded-xl border px-3 py-1.5 text-sm font-bold tracking-wide backdrop-blur-md ${overlayTone[dragDirection]} ${overlayEdge[dragDirection]} ${
                ready ? 'ring-2 ring-white/40' : ''
              }`}
              style={{ opacity: overlayOpacity }}
              aria-live="polite"
            >
              {dragOverlayText}
            </div>
          ) : null}
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-[var(--color-fg)]">
              {track.title}
            </h2>
            <p className="truncate text-sm text-[var(--color-muted)]">
              {track.artist}
            </p>
            <p className="truncate text-xs font-medium uppercase tracking-wide text-[var(--color-accent)]">
              {sourceLabel}
            </p>
          </div>

          {playback ? (
            <div
              ref={seekRef}
              className="space-y-1.5 touch-auto"
              style={{ touchAction: 'auto' }}
              onPointerDown={stopSeekGesture}
              onPointerUp={stopSeekGesture}
            >
              <input
                type="range"
                min={0}
                max={progressMax || 1}
                step={0.1}
                value={Math.min(playback.currentTime, progressMax || 1)}
                disabled={!playback.canSeek || progressMax <= 0}
                onChange={(event) =>
                  playback.onSeek(Number(event.target.value))
                }
                className="deck-seek"
                aria-label="Позиция воспроизведения"
              />
              <div className="flex justify-between text-xs text-[var(--color-muted)]">
                <span>{formatPlaybackTime(playback.currentTime)}</span>
                <span>{formatPlaybackTime(playback.duration)}</span>
              </div>
              {playback.error ? (
                <p className="text-xs text-rose-600" role="alert">
                  {playback.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </animated.article>
  )
}
