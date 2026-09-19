import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { musicSourceRegistry } from '../sources'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'

export default function Library() {
  const navigate = useNavigate()
  const sourceTracks = useCollectionStore((state) => state.sourceTracks)
  const assignments = useCollectionStore((state) => state.assignments)
  const categories = useCollectionStore((state) => state.categories)
  const likedTracks = useCollectionStore((state) => state.likedTracks)
  const removeSourceTrack = useCollectionStore((state) => state.removeSourceTrack)
  const assignTrackToCategory = useCollectionStore(
    (state) => state.assignTrackToCategory,
  )
  const setCurrentTrackId = usePlayerStore((state) => state.setCurrentTrackId)

  const catalogName = useMemo(() => {
    const map = new Map(categories.map((item) => [item.id, item.name]))
    return (categoryId: string) => map.get(categoryId) ?? 'Каталог'
  }, [categories])

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Медиатека</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Общая коллекция из всех источников. Каталоги — это ваши подборки.
        </p>
      </div>

      {sourceTracks.length === 0 && likedTracks.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          Пока пусто. Добавьте ссылку Zaycev.net в разделе «Источники» или отсортируйте демо-ленту
          свайпами.
        </p>
      ) : null}

      <ul className="space-y-3">
        {sourceTracks.map((track) => {
          const catalogs = assignments
            .filter((item) => item.trackId === track.id)
            .map((item) => catalogName(item.categoryId))
          const sourceLabel = musicSourceRegistry.has(track.sourceId)
            ? musicSourceRegistry.get(track.sourceId).label
            : track.sourceId

          return (
            <li
              key={track.id}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <p className="font-medium">{track.title}</p>
              <p className="text-sm text-[var(--color-muted)]">{track.artist}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {sourceLabel}
                {catalogs.length > 0 ? ` · ${catalogs.join(', ')}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-11 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white"
                  onClick={() => {
                    setCurrentTrackId(track.id)
                    navigate('/player')
                  }}
                >
                  Открыть карточку
                </button>
                <select
                  className="h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) {
                      assignTrackToCategory(track.id, event.target.value)
                      event.target.value = ''
                    }
                  }}
                >
                  <option value="">В каталог…</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="h-11 rounded-xl border border-[var(--color-border)] px-4 text-sm"
                  onClick={() => removeSourceTrack(track.id)}
                >
                  Удалить
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
