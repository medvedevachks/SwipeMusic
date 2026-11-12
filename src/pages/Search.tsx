import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DevSearchLogPanel } from '../components/DevSearchLogPanel'
import {
  isSearchSeedPlaybackEnabled,
  planSearchPlayback,
  selectSearchPlaybackTracks,
} from '../services/continuation/index.ts'
import { isSearchFlowHarnessEnabled } from '../services/continuation/searchFlowHarnessFlag.ts'
import { getPlaybackIntent } from '../services/playbackIntent'
import { useSearchStore } from '../store/searchStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import type { Track } from '../types/track'

export default function Search() {
  const navigate = useNavigate()
  const query = useSearchStore((state) => state.query)
  const loading = useSearchStore((state) => state.loading)
  const loadingMore = useSearchStore((state) => state.loadingMore)
  const hasMore = useSearchStore((state) => state.hasMore)
  const results = useSearchStore((state) => state.results)
  const error = useSearchStore((state) => state.error)
  const activeSources = useSearchStore((state) => state.activeSources)
  const recentSearches = useSearchStore((state) => state.recentSearches)
  const setQuery = useSearchStore((state) => state.setQuery)
  const search = useSearchStore((state) => state.search)
  const searchNext = useSearchStore((state) => state.searchNext)
  const clear = useSearchStore((state) => state.clear)
  const removeRecentSearch = useSearchStore((state) => state.removeRecentSearch)
  const clearHistory = useSearchStore((state) => state.clearHistory)
  const applySearchDeck = useSwipeDeckSessionStore((state) => state.applySearchDeck)

  const [draft, setDraft] = useState(query)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)

  /**
   * Play из строки поиска → SEARCH seed-сессия + UI колоды на /.
   * Не трогает SWIPES SessionStore; не dump'ит hits в PlaybackQueue / applySearchDeck.
   * NAV-SEARCH-01: экран «Свайпы» показывает карточки активной SEARCH session.
   */
  const playSearchResult = (tracks: Track[], selectedTrackId?: string, q?: string) => {
    const playbackTracks = selectSearchPlaybackTracks({
      tracks,
      allowDemo: isSearchFlowHarnessEnabled(),
    })
    const plan = planSearchPlayback({
      enabled: isSearchSeedPlaybackEnabled(),
      tracks: playbackTracks,
      selectedTrackId,
      query: q ?? query,
    })
    const track =
      plan.mode === 'single-track'
        ? plan.track
        : (playbackTracks.find((item) => item.id === selectedTrackId) ??
          playbackTracks[0])
    if (!track) {
      return
    }
    const seedQuery = plan.mode === 'single-track' ? plan.query : (q ?? query)
    void (async () => {
      try {
        await getPlaybackIntent().playSearchTrack({
          track,
          query: seedQuery,
          searchHits: playbackTracks,
        })
      } catch {
        // resolve / autoplay — BottomPlayer; seed уже в SEARCH-слоте при SessionSwitch.
      }
      // После commit SEARCH: Home читает playback deck (search-seed), не SWIPES browse.
      navigate('/')
    })()
  }

  /**
   * Явное «в свайпы»: только UI-колода Home + маршрут /.
   * Воспроизведение не стартует — иначе подменялась бы очередь/сессия без жеста Play.
   * Берёт уже загруженные results (включая догруженные страницы).
   */
  const openAllInSwipes = (tracks: Track[], selectedTrackId?: string, q?: string) => {
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

  useEffect(() => {
    const node = loadMoreSentinelRef.current
    if (!node || !hasMore || loading || loadingMore || results.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }
        void searchNext()
      },
      { root: null, rootMargin: '240px 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, results.length, searchNext])

  return (
    <section className="space-y-5 pb-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Поиск
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Поиск композиций сразу по всем активным источникам
        </p>
      </div>

      <form className="flex gap-2" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Песня, исполнитель или альбом"
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

      {import.meta.env.DEV ? <DevSearchLogPanel /> : null}

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-sm font-medium text-[var(--color-fg)]">
                Найдено: {results.length}
                {hasMore ? '+' : ''}
              </h2>
              {activeSources.length > 0 ? (
                <p className="truncate text-xs text-[var(--color-muted)]">
                  Источники: {activeSources.join(', ')}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)]"
              onClick={() => openAllInSwipes(results, results[0]?.id, query)}
            >
              Открыть все в свайпах
            </button>
          </div>

          <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {results.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="flex w-full min-h-11 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  onClick={() => playSearchResult(results, track.id, query)}
                >
                  <span
                    className="h-12 w-12 shrink-0 rounded-lg bg-cover bg-center"
                    style={
                      track.coverUrl
                        ? { backgroundImage: `url(${track.coverUrl})` }
                        : {
                            backgroundColor:
                              track.coverColor ?? 'var(--color-accent)',
                          }
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                      {track.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">
                      {track.artist}
                      {track.album ? ` · ${track.album}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div ref={loadMoreSentinelRef} className="h-1 w-full" aria-hidden />

          {loadingMore ? (
            <p className="text-center text-sm text-[var(--color-muted)]" role="status">
              Загружаем ещё…
            </p>
          ) : null}

          {hasMore && !loadingMore ? (
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-fg)]"
              onClick={() => {
                void searchNext()
              }}
            >
              Загрузить ещё
            </button>
          ) : null}

          {!hasMore && !loadingMore ? (
            <p className="text-center text-xs text-[var(--color-muted)]">
              Больше результатов нет
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
