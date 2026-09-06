import type { LibrarySortField } from '../../types/library'
import { sourceManager } from '../../sources'
import { useCollectionStore } from '../../store/collectionStore'

type LibraryToolbarProps = {
  query: string
  sortField: LibrarySortField
  sortDirection: 'asc' | 'desc'
  likedOnly: boolean
  sourceIds: string[]
  onQueryChange: (value: string) => void
  onSortChange: (field: LibrarySortField) => void
  onToggleLikedOnly: () => void
  onToggleSource: (sourceId: string) => void
  onRefresh: () => void
}

const SORT_OPTIONS: { value: LibrarySortField; label: string }[] = [
  { value: 'title', label: 'Название' },
  { value: 'artist', label: 'Исполнитель' },
  { value: 'album', label: 'Альбом' },
  { value: 'addedAt', label: 'Дата добавления' },
  { value: 'lastPlayedAt', label: 'Последнее воспроизведение' },
  { value: 'playCount', label: 'Play Count' },
  { value: 'skipCount', label: 'Skip Count' },
  { value: 'duration', label: 'Длительность' },
  { value: 'source', label: 'Источник' },
]

export function LibraryToolbar({
  query,
  sortField,
  sortDirection,
  likedOnly,
  sourceIds,
  onQueryChange,
  onSortChange,
  onToggleLikedOnly,
  onToggleSource,
  onRefresh,
}: LibraryToolbarProps) {
  const categories = useCollectionStore((state) => state.categories)
  const sources = sourceManager.listSources()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Поиск по всей библиотеке…"
          className="min-w-[12rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]"
        />
        <select
          value={sortField}
          onChange={(event) =>
            onSortChange(event.target.value as LibrarySortField)
          }
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]"
          aria-label="Сортировка"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({sortDirection === 'asc' ? '↑' : '↓'})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onToggleLikedOnly}
          className={[
            'rounded-xl px-3 py-2 text-sm',
            likedOnly
              ? 'bg-[var(--color-accent)] text-white'
              : 'border border-[var(--color-border)] text-[var(--color-fg)]',
          ].join(' ')}
        >
          ♥ Лайки
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]"
        >
          Обновить
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          const active = sourceIds.includes(source.id)
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onToggleSource(source.id)}
              className={[
                'rounded-lg px-2.5 py-1 text-xs',
                active
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-muted)]',
              ].join(' ')}
            >
              {source.name}
              {!source.enabled ? ' (выкл)' : ''}
            </button>
          )
        })}
        {categories.slice(0, 8).map((category) => (
          <span
            key={category.id}
            className="rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)]"
          >
            {category.name}
          </span>
        ))}
      </div>
    </div>
  )
}
