import type { LibraryEntry } from '../../types/trackMeta'
import { getSourceDisplayName } from '../../utils/sourceDisplay'
import { formatPlaybackTime } from '../../utils/formatTime'

type LibraryTrackRowProps = {
  entry: LibraryEntry
  categoryLabels: string[]
  selected: boolean
  onToggleSelect: () => void
  onOpenActions: () => void
  onPlay: () => void
}

export function LibraryTrackRow({
  entry,
  categoryLabels,
  selected,
  onToggleSelect,
  onOpenActions,
  onPlay,
}: LibraryTrackRowProps) {
  const { track, meta } = entry
  const durationSec =
    track.durationMs != null ? Math.round(track.durationMs / 1000) : 0

  return (
    <div className="flex h-full items-center gap-2 px-2 sm:gap-3 sm:px-3">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="h-4 w-4 accent-[var(--color-accent)]"
        aria-label={`Выбрать ${track.title}`}
      />

      <button
        type="button"
        className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--color-border)]"
        style={{
          backgroundColor: track.coverColor ?? 'var(--color-accent)',
          backgroundImage: track.coverUrl ? `url(${track.coverUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        onClick={onPlay}
        aria-label={`Воспроизвести ${track.title}`}
      />

      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onOpenActions}
      >
        <p className="truncate text-sm font-medium text-[var(--color-fg)]">
          {track.title}
        </p>
        <p className="truncate text-xs text-[var(--color-muted)]">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </p>
        <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-accent)]">
          {getSourceDisplayName(track.sourceId)}
          {categoryLabels.length > 0 ? ` · ${categoryLabels.join(', ')}` : ''}
        </p>
      </button>

      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-[10px] text-[var(--color-muted)] sm:flex">
        <span>{durationSec > 0 ? formatPlaybackTime(durationSec) : '—'}</span>
        <span>
          {meta.liked || meta.favorite ? '♥' : '♡'} · ▶{meta.playCount} · ⏭
          {meta.skipCount}
        </span>
      </div>
    </div>
  )
}
