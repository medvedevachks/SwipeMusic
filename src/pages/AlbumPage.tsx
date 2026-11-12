import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SearchResultRow } from '../components/search/SearchResultRow'
import { getCatalogBrowseService } from '../services/catalogBrowse'
import { getPlaybackIntent } from '../services/playbackIntent'
import type { CatalogAlbumDetail } from '../types/catalog'
import type { Track } from '../types/track'
import { getSourceDisplayName } from '../utils/sourceDisplay'

export default function AlbumPage() {
  const { sourceId = '', albumId = '' } = useParams()
  const navigate = useNavigate()
  const catalog = getCatalogBrowseService()

  const [album, setAlbum] = useState<CatalogAlbumDetail | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadGen = useRef(0)

  useEffect(() => {
    const generation = ++loadGen.current
    setLoading(true)
    setError(null)
    setTracks([])
    setCursor(null)

    void (async () => {
      try {
        const detail = await catalog.getAlbum(sourceId, albumId)
        if (generation !== loadGen.current) {
          return
        }
        if (!detail) {
          setAlbum(null)
          setError('Альбом недоступен для этого источника')
          setLoading(false)
          return
        }
        setAlbum(detail)
        const page = await catalog.getAlbumTracks(sourceId, albumId, {
          cursor: null,
        })
        if (generation !== loadGen.current) {
          return
        }
        setTracks(page.items)
        setCursor(page.nextCursor)
      } catch (err) {
        if (generation !== loadGen.current) {
          return
        }
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (generation === loadGen.current) {
          setLoading(false)
        }
      }
    })()
  }, [albumId, catalog, sourceId])

  const loadMore = async () => {
    if (!cursor || loadingMore) {
      return
    }
    setLoadingMore(true)
    try {
      const page = await catalog.getAlbumTracks(sourceId, albumId, { cursor })
      setTracks((prev) => [...prev, ...page.items])
      setCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !cursor || loadingMore) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore()
        }
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loadingMore, tracks.length])

  const playFrom = (startIndex: number) => {
    if (!album || tracks.length === 0) {
      return
    }
    void getPlaybackIntent().playAlbum({
      tracks,
      startIndex,
      album: {
        id: album.id,
        title: album.title,
        ...(album.artistName ? { artist: album.artistName } : {}),
      },
    })
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--color-muted)]" role="status">
        Загружаем альбом…
      </p>
    )
  }

  if (!album) {
    return (
      <div className="space-y-3">
        <Link to="/search" className="text-sm text-[var(--color-accent)]">
          ← К поиску
        </Link>
        <p className="text-sm text-rose-600" role="alert">
          {error ?? 'Альбом не найден'}
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-5 pb-4">
      <button
        type="button"
        className="text-sm text-[var(--color-accent)]"
        onClick={() => navigate(-1)}
      >
        ← Назад
      </button>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <span
          className="mx-auto h-44 w-44 shrink-0 rounded-2xl bg-cover bg-center sm:mx-0 sm:h-52 sm:w-52"
          style={
            album.coverUrl
              ? { backgroundImage: `url(${album.coverUrl})` }
              : { backgroundColor: 'var(--color-accent)' }
          }
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Альбом · {getSourceDisplayName(album.sourceId)}
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
            {album.title}
          </h1>
          {album.artistName ? (
            <p className="text-sm text-[var(--color-muted)]">{album.artistName}</p>
          ) : null}
          <button
            type="button"
            className="min-h-11 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-40"
            disabled={tracks.length === 0}
            onClick={() => playFrom(0)}
          >
            Слушать альбом
          </button>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--color-fg)]">
          Треки: {tracks.length}
          {cursor ? '+' : ''}
        </h2>
        {tracks.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Треки не найдены</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {tracks.map((track, index) => (
              <li key={track.id}>
                <SearchResultRow
                  track={track}
                  onPlay={() => playFrom(index)}
                />
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinelRef} className="h-1" aria-hidden />
        {loadingMore ? (
          <p className="text-center text-sm text-[var(--color-muted)]">
            Загружаем ещё…
          </p>
        ) : null}
        {cursor && !loadingMore ? (
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-border)] text-sm"
            onClick={() => {
              void loadMore()
            }}
          >
            Загрузить ещё
          </button>
        ) : null}
      </div>
    </section>
  )
}
