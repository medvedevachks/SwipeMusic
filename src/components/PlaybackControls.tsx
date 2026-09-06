import { Link } from 'react-router-dom'
import { PlaybackModeBadge } from './PlaybackModeBadge'
import { usePlayerStore } from '../store/playerStore'

type PlaybackControlsProps = {
  /** Навигация колоды (свайп-источник истины). */
  onPreviousTrack?: () => void
  onNextTrack?: () => void
}

/**
 * Кнопки prev / play-pause / next.
 * Play/Pause — PlayerStore; prev/next — колода (если переданы колбэки).
 */
export default function PlaybackControls({
  onPreviousTrack,
  onNextTrack,
}: PlaybackControlsProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const playing = usePlayerStore((state) => state.playing)
  const paused = usePlayerStore((state) => state.paused)
  const pause = usePlayerStore((state) => state.pause)
  const resume = usePlayerStore((state) => state.resume)
  const next = usePlayerStore((state) => state.next)
  const previous = usePlayerStore((state) => state.previous)
  const queueLength = usePlayerStore((state) => state.queue.length)

  const canControl = Boolean(currentTrack)

  return (
    <div className="flex flex-col items-center gap-2">
      {currentTrack ? (
        <div className="flex max-w-full items-center justify-center gap-2 px-2">
          <p className="truncate text-sm font-medium text-[var(--color-fg)]">
            {currentTrack.title}
          </p>
          <PlaybackModeBadge />
        </div>
      ) : null}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] text-lg text-[var(--color-fg)] disabled:opacity-40"
          disabled={!canControl}
          aria-label="Предыдущий трек"
          onClick={() => {
            if (onPreviousTrack) {
              onPreviousTrack()
              return
            }
            void previous()
          }}
        >
          ⏮
        </button>
        <button
          type="button"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-accent)] text-xl font-semibold text-white disabled:opacity-40"
          disabled={!canControl}
          aria-label={playing ? 'Пауза' : 'Воспроизведение'}
          onClick={() => {
            if (playing) {
              pause()
              return
            }
            void resume()
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] text-lg text-[var(--color-fg)] disabled:opacity-40"
          disabled={!canControl}
          aria-label="Следующий трек"
          onClick={() => {
            if (onNextTrack) {
              onNextTrack()
              return
            }
            void next()
          }}
        >
          ⏭
        </button>
      </div>
      <Link
        to="/queue"
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
      >
        Очередь ({queueLength})
      </Link>
      <span className="sr-only">
        {paused ? 'На паузе' : playing ? 'Играет' : 'Остановлен'}
      </span>
    </div>
  )
}
