import { VolumeIcon } from '../icons'

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
  const level =
    muted || effective === 0 ? 'mute' : effective < 0.4 ? 'low' : effective < 0.75 ? 'mid' : 'high'

  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        className="deck-key deck-key-utility"
        aria-label={muted ? 'Включить звук' : 'Без звука'}
        aria-pressed={muted}
        onClick={onToggleMute}
      >
        <VolumeIcon level={level} className="h-4 w-4" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        aria-label="Громкость"
        className="deck-volume hidden sm:block"
        onChange={(event) => {
          const next = Number(event.target.value)
          onVolumeChange(next)
        }}
      />
    </div>
  )
}
