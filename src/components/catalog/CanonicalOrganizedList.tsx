import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import {
  formatSourceCopyCount,
  listCanonicalItems,
} from '../../services/canonical/selectors'
import { getSourceDisplayName } from '../../utils/sourceDisplay'

/** Пользовательская библиотека: одна композиция — одна строка. Без Play и без fallback. */
export function CanonicalOrganizedList() {
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const items = listCanonicalItems(Object.values(itemsById))

  return (
    <section className="space-y-3" aria-label="Моя музыка">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          Моя музыка
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Сохранённые композиции. Несколько источников одной песни показаны одной строкой.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-muted)]">
          Сохранённых композиций пока нет
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.canonicalTrack.id}
              className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            >
              <span
                className="h-12 w-12 shrink-0 rounded-lg border border-[var(--color-border)]"
                style={{
                  backgroundColor: 'var(--color-accent)',
                  backgroundImage: item.canonicalTrack.artworkUrl
                    ? `url(${item.canonicalTrack.artworkUrl})`
                    : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                  {item.canonicalTrack.title}
                  {item.state.liked ? ' · лайк' : ''}
                </span>
                <span className="block truncate text-xs text-[var(--color-muted)]">
                  {item.canonicalTrack.artist}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-accent)]">
                    {formatSourceCopyCount(item.copies.length)}
                  </span>
                  {item.copies.map((copy) => (
                    <span
                      key={copy.sourceTrackKey}
                      className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]"
                    >
                      {getSourceDisplayName(copy.sourceId)}
                    </span>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
