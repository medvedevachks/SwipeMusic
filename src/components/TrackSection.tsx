import type { Track } from '../types/track'
import TrackCard from './TrackCard'

type TrackSectionProps = {
  title: string
  tracks: Track[]
}

export default function TrackSection({ title, tracks }: TrackSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--color-fg)] sm:text-xl">
          {title}
        </h2>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tracks.map((track) => (
          <TrackCard key={track.id} track={track} />
        ))}
      </div>
    </section>
  )
}
