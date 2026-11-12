import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SearchResultRow } from '../components/search/SearchResultRow'
import { getCatalogBrowseService } from '../services/catalogBrowse'
import { getPlaybackIntent } from '../services/playbackIntent'
import type { CatalogAlbum, CatalogArtistDetail } from '../types/catalog'
import type { Track } from '../types/track'
import { getSourceDisplayName } from '../utils/sourceDisplay'

export default function ArtistPage() {
  const { sourceId = '', artistId = '' } = useParams()
  const navigate = useNavigate()
  const catalog = getCatalogBrowseService()

  const [artist, setArtist] = useState<CatalogArtistDetail | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [albums, setAlbums] = useState<CatalogAlbum[]>([])
  const [tracksCursor, setTracksCursor] = useState<string | null>(null)
  const [albumsCursor, setAlbumsCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [loadingAlbums, setLoadingAlbums] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tracksSentinelRef = useRef<HTMLDivElement | null>(null)
  const albumsSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadGen = useRef(0)

  useEffect(() => {
    const generation = ++loadGen.current
    setLoading(true)
    setError(null)
    setTracks([])
    setAlbums([])
    setTracksCursor(null)
    setAlbumsCursor(null)

    void (async () => {
      try {
        const detail = await catalog.getArtist(sourceId, artistId)
        if (generation !== loadGen.current) {
          return
        }
        if (!detail) {
          setArtist(null)
          setError('Исполнитель недоступен для этого источника')
          setLoading(false)
          return
        }
        setArtist(detail)

        const [tracksPage, albumsPage] = await Promise.all([
          catalog.getArtistTracks(sourceId, artistId, { cursor: null }),
          catalog.getArtistAlbums(sourceId, artistId, { cursor: null }),
        ])
        if (generation !== loadGen.current) {
          return
        }
        setTracks(tracksPage.items)
        setTracksCursor(tracksPage.nextCursor)
        setAlbums(albumsPage.items)
        setAlbumsCursor(albumsPage.nextCursor)
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
  }, [artistId, catalog, sourceId])

  const loadMoreTracks = async () => {
    if (!tracksCursor || loadingTracks) {
      return
    }
    setLoadingTracks(true)
    try {
      const page = await catalog.getArtistTracks(sourceId, artistId, {
        cursor: tracksCursor,
      })
      setTracks((prev) => [...prev, ...page.items])
      setTracksCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingTracks(false)
    }
  }

  const loadMoreAlbums = async () => {
    if (!albumsCursor || loadingAlbums) {
      return
    }
    setLoadingAlbums(true)
    try {
      const page = await catalog.getArtistAlbums(sourceId, artistId, {
        cursor: albumsCursor,
      })
      setAlbums((prev) => [...prev, ...page.items])
      setAlbumsCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingAlbums(false)
    }
  }

  useEffect(() => {
    const node = tracksSentinelRef.current
    if (!node || !tracksCursor || loadingTracks) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreTracks()
        }
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [tracksCursor, loadingTracks, tracks.length])

  useEffect(() => {
    const node = albumsSentinelRef.current
    if (!node || !albumsCursor || loadingAlbums) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreAlbums()
        }
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [albumsCursor, loadingAlbums, albums.length])

  const playTrack = (trackId: string) => {
    const track = tracks.find((item) => item.id === trackId) ?? tracks[0]
    if (!track) {
      return
    }
    void (async () => {
      try {
        await getPlaybackIntent().playSearchTrack({
          track,
          query: artist?.name ?? '',
          searchHits: tracks,
        })
      } catch {
        // resolve / autoplay — BottomPlayer; seed уже в SEARCH-слоте при SessionSwitch.
      }
      navigate('/')
    })()
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--color-muted)]" role="status">
        Загружаем исполнителя…
      </p>
    )
  }

  if (!artist) {
    return (
      <div className="space-y-3">
        <Link to="/search" className="text-sm text-[var(--color-accent)]">
          ← К поиску
        </Link>
        <p className="text-sm text-rose-600" role="alert">
          {error ?? 'Исполнитель не найден'}
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-6 pb-4">
      <Link to="/search" className="text-sm text-[var(--color-accent)]">
        ← К поиску
      </Link>

      <header className="flex flex-col items-center gap-4 sm:flex-row sm:items-end">
        <span
          className="h-36 w-36 shrink-0 rounded-full bg-cover bg-center sm:h-44 sm:w-44"
          style={
            artist.imageUrl
              ? { backgroundImage: `url(${artist.imageUrl})` }
              : { backgroundColor: 'var(--color-accent)' }
          }
          aria-hidden
        />
        <div className="min-w-0 space-y-1 text-center sm:text-left">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Исполнитель · {getSourceDisplayName(artist.sourceId)}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
            {artist.name}
          </h1>
          {artist.tracksMode === 'album-derived' ? (
            <p className="text-xs text-[var(--color-muted)]">
              Песни загружаются из альбомов источника (нет единого списка треков
              API).
            </p>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="text-sm text-rose-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--color-fg)]">
          Альбомы{albums.length ? `: ${albums.length}` : ''}
          {albumsCursor ? '+' : ''}
        </h2>
        {albums.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Альбомы не найдены</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {albums.map((album) => (
              <li key={album.id}>
                <button
                  type="button"
                  className="w-full space-y-2 text-left"
                  onClick={() =>
                    navigate(
                      `/search/albums/${encodeURIComponent(album.sourceId)}/${encodeURIComponent(album.externalId)}`,
                    )
                  }
                >
                  <span
                    className="block aspect-square w-full rounded-xl bg-cover bg-center"
                    style={
                      album.coverUrl
                        ? { backgroundImage: `url(${album.coverUrl})` }
                        : { backgroundColor: 'var(--color-accent)' }
                    }
                    aria-hidden
                  />
                  <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                    {album.title}
                  </span>
                  {album.year ? (
                    <span className="block text-xs text-[var(--color-muted)]">
                      {album.year}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={albumsSentinelRef} className="h-1" aria-hidden />
        {loadingAlbums ? (
          <p className="text-center text-sm text-[var(--color-muted)]">
            Загружаем альбомы…
          </p>
        ) : null}
        {albumsCursor && !loadingAlbums ? (
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-border)] text-sm"
            onClick={() => {
              void loadMoreAlbums()
            }}
          >
            Ещё альбомы
          </button>
        ) : null}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--color-fg)]">
          Песни{tracks.length ? `: ${tracks.length}` : ''}
          {tracksCursor ? '+' : ''}
        </h2>
        {artist.tracksMode === 'unsupported' ? (
          <p className="text-sm text-[var(--color-muted)]">
            Источник не отдаёт список песен исполнителя. Откройте альбом.
          </p>
        ) : tracks.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Песни не найдены</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {tracks.map((track) => (
              <li key={`${track.id}:${track.album ?? ''}`}>
                <SearchResultRow
                  track={track}
                  onPlay={() => playTrack(track.id)}
                />
              </li>
            ))}
          </ul>
        )}
        <div ref={tracksSentinelRef} className="h-1" aria-hidden />
        {loadingTracks ? (
          <p className="text-center text-sm text-[var(--color-muted)]">
            Загружаем песни…
          </p>
        ) : null}
        {tracksCursor && !loadingTracks ? (
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-border)] text-sm"
            onClick={() => {
              void loadMoreTracks()
            }}
          >
            Ещё песни
          </button>
        ) : null}
      </div>
    </section>
  )
}
