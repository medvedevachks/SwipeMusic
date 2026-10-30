import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCategoryGlyph } from '../config/categoryPresets'
import { PlayIcon } from '../components/icons'
import { removeCanonicalFromCatalog } from '../services/canonical/userOrganization'
import {
  canonicalCatalogCount,
  canonicalTracksInCatalog,
  formatSourceCopyCount,
  listCanonicalItems,
} from '../services/canonical/selectors'
import {
  canDeleteCatalog,
  formatCatalogTrackCount,
  getCatalogById,
} from '../services/catalogs/selectCatalogs'
import { SYS_SWIPES_ID } from '../services/catalogs/systemFolders'
import {
  CATALOG_PLAYBACK_MESSAGE,
  cancelCatalogPlaybackGate,
  playUserCatalog,
} from '../services/catalogPlayback'
import { useCanonicalLibraryStore } from '../store/canonicalLibraryStore'
import { useCollectionStore } from '../store/collectionStore'
import { getSourceDisplayName } from '../utils/sourceDisplay'

export default function CatalogDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const catalogId = params.catalogId ?? ''
  const categories = useCollectionStore((state) => state.categories)
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const updateCategory = useCollectionStore((state) => state.updateCategory)
  const deleteCategory = useCollectionStore((state) => state.deleteCategory)

  const catalog = getCatalogById(categories, catalogId)
  const canonicalItems = listCanonicalItems(Object.values(itemsById))
  const tracks = canonicalTracksInCatalog(canonicalItems, catalogId)
  const count = canonicalCatalogCount(canonicalItems, catalogId)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [playHint, setPlayHint] = useState<string | null>(null)
  const playGeneration = useRef(0)

  useEffect(() => {
    return () => {
      playGeneration.current += 1
      cancelCatalogPlaybackGate()
    }
  }, [catalogId])

  useEffect(() => {
    if (catalogId === SYS_SWIPES_ID) {
      navigate('/library/swipes', { replace: true })
    }
  }, [catalogId, navigate])

  if (catalogId === SYS_SWIPES_ID) {
    return null
  }

  if (removed) {
    return null
  }

  if (!catalog) {
    return (
      <section className="space-y-4">
        <h1 className="font-display text-2xl font-semibold text-[var(--color-fg)]">
          Каталог не найден
        </h1>
        <Link
          to="/library"
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--color-border)] px-3 text-sm"
        >
          К библиотеке
        </Link>
      </section>
    )
  }

  const saveName = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    updateCategory(catalog.id, { name: trimmed })
    setRenaming(false)
  }

  const runPlay = async (startCanonicalTrackId?: string) => {
    if (busyKey) {
      setPlayError(CATALOG_PLAYBACK_MESSAGE.BUSY)
      return
    }
    const generation = ++playGeneration.current
    const key = startCanonicalTrackId ?? 'catalog'
    setBusyKey(key)
    setPlayError(null)
    setPlayHint(null)
    try {
      const result = await playUserCatalog({
        catalog: { id: catalog.id, name: catalog.name },
        items: tracks,
        startCanonicalTrackId,
      })
      if (generation !== playGeneration.current) {
        return
      }
      if (result.status === 'played') {
        setPlayError(null)
        if (result.needsUserPlayGesture) {
          setPlayHint(CATALOG_PLAYBACK_MESSAGE.NEEDS_USER_PLAY)
        }
        return
      }
      setPlayError(result.message)
    } catch {
      if (generation === playGeneration.current) {
        setPlayError(CATALOG_PLAYBACK_MESSAGE.FAILED)
      }
    } finally {
      if (generation === playGeneration.current) {
        setBusyKey(null)
      }
    }
  }

  const catalogBusy = busyKey === 'catalog'
  const anyBusy = busyKey !== null

  return (
    <section className="space-y-4 pb-8">
      <Link
        to="/library"
        className="inline-flex min-h-11 items-center text-sm text-[var(--color-muted)]"
      >
        ← Библиотека
      </Link>

      <div className="flex items-start gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl text-white"
          style={{ backgroundColor: catalog.color }}
          aria-hidden="true"
        >
          {getCategoryGlyph(catalog.icon)}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            {catalog.name}
            {catalog.favorite ? ' ★' : ''}
          </h1>
          {catalog.description ? (
            <p className="text-sm text-[var(--color-muted)]">{catalog.description}</p>
          ) : null}
          <p className="text-sm text-[var(--color-muted)]">
            {formatCatalogTrackCount(count)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-60"
          disabled={anyBusy || tracks.length === 0}
          aria-busy={catalogBusy || undefined}
          aria-label="Слушать каталог"
          onClick={() => {
            void runPlay()
          }}
        >
          {catalogBusy ? (
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <PlayIcon className="h-5 w-5 translate-x-0.5" />
          )}
          Слушать каталог
        </button>
      </div>

      {playError ? (
        <p
          className="rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100"
          role="alert"
        >
          {playError}
        </p>
      ) : null}

      {playHint ? (
        <p
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]"
          role="status"
        >
          {playHint}
        </p>
      ) : null}

      {renaming ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveName()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Новое название каталога"
            className="min-h-11 min-w-[12rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            autoFocus
          />
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-[var(--color-accent)] px-3 text-sm font-medium text-white"
          >
            Сохранить
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
            onClick={() => setRenaming(false)}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
            onClick={() => {
              setName(catalog.name)
              setRenaming(true)
              setConfirmDelete(false)
            }}
          >
            Переименовать
          </button>
          {canDeleteCatalog(catalog) ? (
            <button
              type="button"
              className="min-h-11 rounded-xl border border-rose-400 px-3 text-sm text-rose-700 dark:text-rose-300"
              onClick={() => setConfirmDelete(true)}
            >
              Удалить каталог
            </button>
          ) : null}
        </div>
      )}

      {confirmDelete ? (
        <div className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-fg)]">
            Удалить каталог «{catalog.name}»?
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            Треки останутся в библиотеке. Будет удалена только их принадлежность
            этому каталогу.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-xl bg-rose-600 px-3 text-sm font-medium text-white"
              onClick={() => {
                setRemoved(true)
                deleteCategory(catalog.id)
                navigate('/library')
              }}
            >
              Удалить
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {tracks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-muted)]">
          В этом каталоге пока нет треков
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((item) => {
            const rowBusy = busyKey === item.canonicalTrack.id
            return (
              <li
                key={item.canonicalTrack.id}
                className="flex min-w-0 items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 sm:gap-3 sm:px-3"
              >
                <button
                  type="button"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white disabled:opacity-60"
                  disabled={anyBusy}
                  aria-busy={rowBusy || undefined}
                  aria-label={`Слушать «${item.canonicalTrack.title}»`}
                  onClick={() => {
                    void runPlay(item.canonicalTrack.id)
                  }}
                >
                  {rowBusy ? (
                    <span
                      className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <PlayIcon className="h-5 w-5 translate-x-0.5" />
                  )}
                </button>
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
                <span className="min-w-0 flex-1 overflow-hidden">
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
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-xl border border-[var(--color-border)] px-2 text-xs sm:px-3"
                  aria-label={`Убрать «${item.canonicalTrack.title}» из каталога`}
                  onClick={() => {
                    void removeCanonicalFromCatalog(
                      item.canonicalTrack.id,
                      catalog.id,
                    )
                  }}
                >
                  <span className="sm:hidden">Убрать</span>
                  <span className="hidden sm:inline">Убрать из каталога</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
