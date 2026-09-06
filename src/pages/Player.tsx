import { usePlayerStore } from '../store/playerStore'
import { formatPlaybackTime } from '../utils/formatTime'

export default function Player() {
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const playing = usePlayerStore((state) => state.playing)
  const paused = usePlayerStore((state) => state.paused)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const volume = usePlayerStore((state) => state.volume)
  const error = usePlayerStore((state) => state.error)
  const pause = usePlayerStore((state) => state.pause)
  const resume = usePlayerStore((state) => state.resume)
  const seek = usePlayerStore((state) => state.seek)
  const next = usePlayerStore((state) => state.next)
  const previous = usePlayerStore((state) => state.previous)
  const setVolume = usePlayerStore((state) => state.setVolume)

  const progressMax = duration > 0 ? duration : 0
  const canControl = Boolean(currentTrack?.previewUrl)

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col gap-6 pb-4">
      <div className="space-y-1 text-center sm:text-left">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Плеер
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Воспроизведение текущего трека
        </p>
      </div>

      <div
        className="aspect-square w-full rounded-3xl shadow-lg"
        style={{
          background:
            currentTrack?.coverColor ??
            'linear-gradient(145deg, var(--color-accent), #134e4a)',
        }}
        aria-hidden
      />

      <div className="space-y-1 text-center">
        <p className="font-display text-xl font-semibold text-[var(--color-fg)]">
          {currentTrack?.title ?? 'Нет трека'}
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          {currentTrack?.artist ?? 'Откройте главную или нажмите «Продолжить»'}
        </p>
        {error && (
          <p className="pt-2 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={progressMax || 1}
          step={0.1}
          value={Math.min(currentTime, progressMax || 1)}
          disabled={!canControl || progressMax <= 0}
          onChange={(event) => seek(Number(event.target.value))}
          className="w-full accent-[var(--color-accent)]"
          aria-label="Позиция воспроизведения"
        />
        <div className="flex justify-between text-xs text-[var(--color-muted)]">
          <span>{formatPlaybackTime(currentTime)}</span>
          <span>{formatPlaybackTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40"
          disabled={!canControl}
          onClick={() => {
            void previous()
          }}
        >
          Назад
        </button>
        <button
          type="button"
          className="min-w-28 rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!canControl}
          onClick={() => {
            if (playing) {
              pause()
              return
            }
            void resume()
          }}
        >
          {playing ? 'Пауза' : paused || currentTrack ? 'Продолжить' : 'Играть'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40"
          disabled={!canControl}
          onClick={() => {
            void next()
          }}
        >
          Далее
        </button>
      </div>

      <label className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
        <span className="w-14 shrink-0">Громкость</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="w-full accent-[var(--color-accent)]"
          aria-label="Громкость"
        />
      </label>
    </section>
  )
}
