import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearchStore } from '../store/searchStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import type { Track } from '../types/track'

export default function Search() {
  const navigate = useNavigate()
  const query = useSearchStore((state) => state.query)
  const loading = useSearchStore((state) => state.loading)
  const results = useSearchStore((state) => state.results)
  const error = useSearchStore((state) => state.error)
  const recentSearches = useSearchStore((state) => state.recentSearches)
  const setQuery = useSearchStore((state) => state.setQuery)
  const search = useSearchStore((state) => state.search)
  const clear = useSearchStore((state) => state.clear)
  const removeRecentSearch = useSearchStore((state) => state.removeRecentSearch)
  const clearHistory = useSearchStore((state) => state.clearHistory)
  const applySearchDeck = useSwipeDeckSessionStore((state) => state.applySearchDeck)

  const [draft, setDraft] = useState(query)

  const openInSwipeDeck = (tracks: Track[], selectedTrackId?: string, q?: string) => {
    applySearchDeck(tracks, {
      selectedTrackId,
      query: q ?? query,
    })
    navigate('/')
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const next = draft.trim()
    if (!next) {
      return
    }
    setQuery(next)
    await search(next)
  }

  return (
    <section className="space-y-5 pb-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Поиск
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Поиск сразу по всем активным источникам
        </p>
      </div>

      <form className="flex gap-2" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Исполнитель или трек"
          className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none ring-[var(--color-accent)] focus:ring-2"
          aria-label="Поисковый запрос"
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Найти
        </button>
        {(query || results.length > 0) && (
          <button
            type="button"
            className="rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-fg)]"
            onClick={() => {
              setDraft('')
              clear()
            }}
          >
            Сброс
          </button>
        )}
      </form>

      {recentSearches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              Недавние
            </h2>
            <button
              type="button"
              className="text-xs text-[var(--color-muted)] underline-offset-2 hover:underline"
              onClick={() => clearHistory()}
            >
              Очистить
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((item) => (
              <div key={item} className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-fg)]"
                  onClick={() => {
                    setDraft(item)
                    setQuery(item)
                    void search(item)
                  }}
                >
                  {item}
                </button>
                <button
                  type="button"
                  aria-label={`Удалить «${item}»`}
                  className="rounded-full px-1.5 text-xs text-[var(--color-muted)]"
                  onClick={() => removeRecentSearch(item)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <p className="text-sm text-[var(--color-muted)]" role="status">
          Ищем по активным источникам…
        </p>
      )}

      {error && (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      )}

      {!loading && query && results.length === 0 && !error && (
        <p className="text-sm text-[var(--color-muted)]">Ничего не найдено</p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-[var(--color-fg)]">
              Найдено: {results.length}
            </h2>
            <button
              type="button"
              className="rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)]"
              onClick={() => openInSwipeDeck(results, results[0]?.id, query)}
            >
              Открыть все в свайпах
            </button>
          </div>

          <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {results.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  onClick={() => openInSwipeDeck(results, track.id, query)}
                >
                  <span
                    className="h-12 w-12 shrink-0 rounded-lg"
                    style={{
                      backgroundColor: track.coverColor ?? 'var(--color-accent)',
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                      {track.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">
                      {track.artist}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
