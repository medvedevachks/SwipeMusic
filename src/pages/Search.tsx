import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DevSearchLogPanel } from '../components/DevSearchLogPanel'
import { SearchArtistRow } from '../components/search/SearchArtistRow'
import { SearchResultRow } from '../components/search/SearchResultRow'
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
import { getSourceDisplayName } from '../utils/sourceDisplay'

export default function Search() {
  const navigate = useNavigate()
  const query = useSearchStore((state) => state.query)
  const loading = useSearchStore((state) => state.loading)
  const loadingMore = useSearchStore((state) => state.loadingMore)
  const hasMore = useSearchStore((state) => state.hasMore)
  const results = useSearchStore((state) => state.results)
  const artists = useSearchStore((state) => state.artists)
  const artistsLoading = useSearchStore((state) => state.artistsLoading)
  const artistsLoadingMore = useSearchStore((state) => state.artistsLoadingMore)
  const artistsHasMore = useSearchStore((state) => state.artistsHasMore)
  const catalogWarnings = useSearchStore((state) => state.catalogWarnings)
  const error = useSearchStore((state) => state.error)
  const providerWarnings = useSearchStore((state) => state.providerWarnings)
  const activeSources = useSearchStore((state) => state.activeSources)
  const recentSearches = useSearchStore((state) => state.recentSearches)
  const setQuery = useSearchStore((state) => state.setQuery)
  const search = useSearchStore((state) => state.search)
  const searchNext = useSearchStore((state) => state.searchNext)
  const searchArtistsNext = useSearchStore((state) => state.searchArtistsNext)
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

  const activeSourceLabels = activeSources.map((id) => getSourceDisplayName(id))

  return (
    <section className="space-y-5 pb-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Поиск
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Один запрос — исполнители и песни по активным источникам
        </p>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Песня, исполнитель или альбом"
          className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none ring-[var(--color-accent)] focus:ring-2"
          aria-label="Поисковый запрос"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="min-h-11 flex-1 rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 sm:flex-none"
          >
            Найти
          </button>
          {(query || results.length > 0) && (
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-fg)]"
              onClick={() => {
                setDraft('')
                clear()
              }}
            >
              Сброс
            </button>
          )}
        </div>
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

      {error && results.length === 0 && (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}

      {(providerWarnings.length > 0 || catalogWarnings.length > 0) &&
        (results.length > 0 || artists.length > 0) && (
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100"
          role="status"
          data-testid="search-provider-warnings"
        >
          <p className="font-medium">Часть источников недоступна</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs opacity-90">
            {[...providerWarnings, ...catalogWarnings].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {!loading &&
        !artistsLoading &&
        query &&
        results.length === 0 &&
        artists.length === 0 &&
        !error && (
        <p className="text-sm text-[var(--color-muted)]">Ничего не найдено</p>
      )}

      {(artists.length > 0 || artistsLoading) && (
        <div className="space-y-3" data-testid="search-artists-section">
          <h2 className="text-sm font-medium text-[var(--color-fg)]">
            Исполнители
            {artists.length > 0 ? `: ${artists.length}` : ''}
          </h2>
          {artistsLoading && artists.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]" role="status">
              Ищем исполнителей…
            </p>
          ) : null}
          {artists.length > 0 ? (
            <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {artists.map((artist) => (
                <li key={artist.id}>
                  <SearchArtistRow
                    artist={artist}
                    onOpen={() =>
                      navigate(
                        `/search/artists/${encodeURIComponent(artist.sourceId)}/${encodeURIComponent(artist.externalId)}`,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {artistsLoadingMore ? (
            <p className="text-sm text-[var(--color-muted)]" role="status">
              Загружаем ещё исполнителей…
            </p>
          ) : null}
          {artistsHasMore && !artistsLoadingMore && artists.length > 0 ? (
            <button
              type="button"
              data-testid="search-artists-load-more"
              className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-fg)]"
              onClick={() => {
                void searchArtistsNext()
              }}
            >
              Ещё исполнители
            </button>
          ) : null}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-sm font-medium text-[var(--color-fg)]">
                Песни: {results.length}
                {hasMore ? '+' : ''}
              </h2>
              {activeSourceLabels.length > 0 ? (
                <p className="truncate text-xs text-[var(--color-muted)]">
                  Источники: {activeSourceLabels.join(', ')}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] sm:min-h-0"
              onClick={() => openAllInSwipes(results, results[0]?.id, query)}
            >
              Открыть все в свайпах
            </button>
          </div>

          <ul
            className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
            data-testid="search-track-list"
          >
            {results.map((track) => (
              <li key={track.id}>
                <SearchResultRow
                  track={track}
                  onPlay={() => playSearchResult(results, track.id, query)}
                />
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
