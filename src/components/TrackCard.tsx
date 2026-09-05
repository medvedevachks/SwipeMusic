import type { Track } from '../types/track'

type TrackCardProps = {
  track: Track
}

export default function TrackCard({ track }: TrackCardProps) {
  return (
    <article className="w-36 shrink-0 snap-start sm:w-40">
      <div
        className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-accent)]"
        style={{
          backgroundColor: track.coverColor ?? undefined,
          backgroundImage: track.coverUrl ? `url(${track.coverUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-black/30" />
        <div className="absolute bottom-3 left-3 h-8 w-8 rounded-md bg-black/25 backdrop-blur-sm" />
      </div>
      <h3 className="mt-2.5 truncate text-sm font-medium text-[var(--color-fg)]">
        {track.title}
      </h3>
      <p className="truncate text-xs text-[var(--color-muted)]">{track.artist}</p>
    </article>
  )
}
