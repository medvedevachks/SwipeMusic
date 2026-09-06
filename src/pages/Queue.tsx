import { Link } from 'react-router-dom'
import { usePlayerStore } from '../store/playerStore'
import type { RepeatMode, ShuffleMode } from '../services/playbackQueue'

function cycleRepeat(mode: RepeatMode): RepeatMode {
  if (mode === 'OFF') {
    return 'ALL'
  }
  if (mode === 'ALL') {
    return 'ONE'
  }
  return 'OFF'
}

function cycleShuffle(mode: ShuffleMode): ShuffleMode {
  return mode === 'OFF' ? 'ON' : 'OFF'
}

export default function QueuePage() {
  const queue = usePlayerStore((state) => state.queue)
  const queueIndex = usePlayerStore((state) => state.queueIndex)
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const playing = usePlayerStore((state) => state.playing)
  const repeatMode = usePlayerStore((state) => state.repeatMode)
  const shuffleMode = usePlayerStore((state) => state.shuffleMode)
  const playTrack = usePlayerStore((state) => state.playTrack)
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue)
  const moveInQueue = usePlayerStore((state) => state.moveInQueue)
  const clearQueue = usePlayerStore((state) => state.clearQueue)
  const setRepeatMode = usePlayerStore((state) => state.setRepeatMode)
  const setShuffleMode = usePlayerStore((state) => state.setShuffleMode)
  const pause = usePlayerStore((state) => state.pause)
  const resume = usePlayerStore((state) => state.resume)

  return (
    <section className="space-y-4 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            Очередь
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            PlaybackQueue — единый порядок воспроизведения
          </p>
        </div>
        <Link
          to="/"
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
        >
          На главную
        </Link>
      </div>

      {currentTrack ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Сейчас
          </p>
          <p className="font-display text-lg font-semibold text-[var(--color-fg)]">
            {currentTrack.title}
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            {currentTrack.artist}
          </p>
          <button
            type="button"
            className="mt-3 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
            onClick={() => {
              if (playing) {
                pause()
              } else {
                void resume()
              }
            }}
          >
            {playing ? 'Пауза' : 'Продолжить'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">Очередь пуста</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
          onClick={() => setShuffleMode(cycleShuffle(shuffleMode))}
        >
          Shuffle: {shuffleMode}
        </button>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
          onClick={() => setRepeatMode(cycleRepeat(repeatMode))}
        >
          Repeat: {repeatMode}
        </button>
        <button
          type="button"
          className="rounded-xl border border-rose-300 px-3 py-2 text-sm text-rose-600 disabled:opacity-40"
          disabled={queue.length === 0}
          onClick={() => clearQueue()}
        >
          Очистить
        </button>
      </div>

      <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {queue.map((track, index) => {
          const active = index === queueIndex
          return (
            <li
              key={`${track.id}-${index}`}
              className={[
                'flex items-center gap-2 px-3 py-2.5',
                active ? 'bg-[var(--color-accent)]/10' : '',
              ].join(' ')}
            >
              <span className="w-6 shrink-0 text-xs text-[var(--color-muted)]">
                {index + 1}
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  void playTrack(track)
                }}
              >
                <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                  {track.title}
                </p>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {track.artist}
                </p>
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-30"
                disabled={index === 0}
                aria-label="Выше"
                onClick={() => moveInQueue(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-30"
                disabled={index >= queue.length - 1}
                aria-label="Ниже"
                onClick={() => moveInQueue(index, index + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs text-rose-600"
                aria-label="Удалить"
                onClick={() => removeFromQueue(track.id)}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
