import { getSourceDisplayName } from '../../utils/sourceDisplay'
import {
  resolveSearchTrackPlayability,
  searchPlayabilityLabel,
} from '../../services/searchEngine/searchPlayability.ts'
import { usePlaybackAvailabilityStore } from '../../store/playbackAvailabilityStore.ts'
import type { Track } from '../../types/track'

type SearchResultRowProps = {
  track: Track
  onPlay: () => void
}

export function SearchResultRow({ track, onPlay }: SearchResultRowProps) {
  const byCanonicalId = usePlaybackAvailabilityStore((state) => state.byCanonicalId)
  const playability = resolveSearchTrackPlayability(track, byCanonicalId)
  const playabilityLabel = searchPlayabilityLabel(playability)
  const sourceLabel = getSourceDisplayName(track.sourceId)
  const album = track.album?.trim() || null

  return (
    <button
      type="button"
      className="flex w-full min-h-14 items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] sm:items-center sm:gap-4 sm:px-4"
      onClick={onPlay}
      aria-label={`Воспроизвести ${track.title} — ${track.artist}`}
    >
      <span
        className="mt-0.5 h-12 w-12 shrink-0 rounded-lg bg-cover bg-center sm:mt-0 sm:h-14 sm:w-14"
        style={
          track.coverUrl
            ? { backgroundImage: `url(${track.coverUrl})` }
            : {
                backgroundColor: track.coverColor ?? 'var(--color-accent)',
              }
        }
        aria-hidden
      />

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium text-[var(--color-fg)] sm:text-[15px]">
          {track.title}
        </span>
        <span className="block truncate text-xs text-[var(--color-muted)] sm:text-sm">
          {track.artist}
        </span>
        {album ? (
          <span className="block truncate text-xs text-[var(--color-muted)]">
            {album}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="rounded-md bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
            {sourceLabel}
          </span>
          {playabilityLabel ? (
            <span
              className={
                playability === 'unavailable'
                  ? 'rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400'
                  : 'rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400'
              }
              data-playability={playability}
            >
              {playabilityLabel}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
