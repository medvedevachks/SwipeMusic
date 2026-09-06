import { downloadAppExportJson } from '../services/export'
import { useCollectionEngineStore } from '../store/collectionEngineStore'
import { useCollectionStore } from '../store/collectionStore'

function formatDate(value: string | null): string {
  if (!value) {
    return '—'
  }
  try {
    return new Date(value).toLocaleString('ru-RU')
  } catch {
    return value
  }
}

export default function Library() {
  const stats = useCollectionEngineStore((state) => state.stats)
  const tracks = useCollectionEngineStore((state) => state.tracks)
  const categories = useCollectionStore((state) => state.categories)

  const visible = tracks.filter((item) => !item.hidden)
  const recentAdded = [...visible]
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .slice(0, 5)
  const recentPlayed = [...visible]
    .filter((item) => item.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, 5)

  const categoryStats = Object.entries(stats.byCategory)
    .map(([categoryId, count]) => ({
      categoryId,
      count,
      name:
        categories.find((category) => category.id === categoryId)?.name ??
        categoryId,
    }))
    .sort((a, b) => b.count - a.count)

  return (
    <section className="space-y-5 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            Коллекция
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            Ваша база треков независимо от источников
          </p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-fg)]"
          onClick={() => downloadAppExportJson()}
        >
          Экспорт JSON
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Треков', value: stats.totalTracks },
          { label: 'Категорий', value: categories.length },
          { label: 'Лайков', value: stats.liked },
          { label: 'Избранное', value: stats.favorites },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
          >
            <p className="text-xs text-[var(--color-muted)]">{item.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-[var(--color-fg)]">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <h2 className="text-sm font-medium text-[var(--color-fg)]">
            Последние добавленные
          </h2>
          {recentAdded.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Пока пусто</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentAdded.map((item) => (
                <li key={item.trackId} className="text-sm">
                  <span className="font-medium text-[var(--color-fg)]">
                    {item.track.title}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {' '}
                    — {item.track.artist}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <h2 className="text-sm font-medium text-[var(--color-fg)]">
            Последние прослушанные
          </h2>
          {recentPlayed.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">Пока пусто</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentPlayed.map((item) => (
                <li key={item.trackId} className="text-sm">
                  <span className="font-medium text-[var(--color-fg)]">
                    {item.track.title}
                  </span>
                  <span className="block text-xs text-[var(--color-muted)]">
                    {formatDate(item.lastPlayed)} · {item.playCount} прослуш.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <h2 className="text-sm font-medium text-[var(--color-fg)]">
          По категориям
        </h2>
        {categoryStats.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Категории появятся после свайпов вправо
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {categoryStats.map((item) => (
              <li
                key={item.categoryId}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[var(--color-fg)]">{item.name}</span>
                <span className="text-[var(--color-muted)]">{item.count}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Скрытых: {stats.hidden} · Проигрываний: {stats.totalPlays} · Skip:{' '}
          {stats.totalSkips}
        </p>
      </div>
    </section>
  )
}
