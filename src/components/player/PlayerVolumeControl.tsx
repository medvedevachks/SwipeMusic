type PlayerVolumeControlProps = {
  volume: number
  muted: boolean
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
}

export default function PlayerVolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: PlayerVolumeControlProps) {
  const effective = muted ? 0 : volume
  const icon =
    muted || effective === 0 ? '🔇' : effective < 0.4 ? '🔈' : effective < 0.75 ? '🔉' : '🔊'

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm text-[var(--color-player-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-player-fg)]"
        aria-label={muted ? 'Включить звук' : 'Без звука'}
        onClick={onToggleMute}
      >
        {icon}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        aria-label="Громкость"
        className="hidden h-1 w-20 accent-[var(--color-accent)] sm:block md:w-24"
        onChange={(event) => {
          const next = Number(event.target.value)
          onVolumeChange(next)
        }}
      />
    </div>
  )
}
