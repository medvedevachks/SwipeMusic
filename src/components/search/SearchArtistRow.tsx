import { getSourceDisplayName } from '../../utils/sourceDisplay'
import type { CatalogArtist } from '../../types/catalog'

type SearchArtistRowProps = {
  artist: CatalogArtist
  onOpen: () => void
}

export function SearchArtistRow({ artist, onOpen }: SearchArtistRowProps) {
  const sourceLabel = getSourceDisplayName(artist.sourceId)

  return (
    <button
      type="button"
      className="flex w-full min-h-14 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] sm:gap-4 sm:px-4"
      onClick={onOpen}
      aria-label={`Открыть исполнителя ${artist.name}`}
    >
      <span
        className="h-12 w-12 shrink-0 rounded-full bg-cover bg-center sm:h-14 sm:w-14"
        style={
          artist.imageUrl
            ? { backgroundImage: `url(${artist.imageUrl})` }
            : { backgroundColor: 'var(--color-accent)' }
        }
        aria-hidden
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium text-[var(--color-fg)] sm:text-[15px]">
          {artist.name}
        </span>
        <span className="rounded-md bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
          {sourceLabel}
        </span>
      </span>
    </button>
  )
}
