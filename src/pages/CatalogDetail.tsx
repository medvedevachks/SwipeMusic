import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
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
import { shouldOpenFullscreenAfterCatalogPlay } from '../navigation/catalogFullscreen'
import { openFullscreenPlayer } from '../navigation/fullscreenPlayer'
import {
  CatalogSyncAmbiguousError,
  deleteCategoryConfirmed,
  isAmbiguousCatalogTransportError,
  updateCategoryConfirmed,
} from '../services/catalogs/catalogCrudConfirmed'
import { isRetryableCategoryCreateError } from '../services/catalogs/categoryPickerCreateGuard'
import { captureAuthSession } from '../services/auth/sessionEpoch'
import { SAVE_FAILED_MESSAGE } from '../services/libraryPersistence/statusStore'
import { useAuthStore } from '../store/authStore'
import { useCanonicalLibraryStore } from '../store/canonicalLibraryStore'
import { useCollectionStore } from '../store/collectionStore'
import { getSourceDisplayName } from '../utils/sourceDisplay'
import {
  applyCatalogRemoveResult,
  beginCatalogTrackRemove,
  createCatalogRemoveBusyState,
  getCatalogRemoveContext,
  switchCatalogRemoveBusyState,
  type CatalogRemoveBusyState,
} from './catalogDetailRemoveBusy'

export default function CatalogDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const catalogId = params.catalogId ?? ''
  const authUserId = useAuthStore((state) => state.user?.id ?? null)
  const categories = useCollectionStore((state) => state.categories)
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)

  const catalog = getCatalogById(categories, catalogId)
  const canonicalItems = listCanonicalItems(Object.values(itemsById))
  const tracks = canonicalTracksInCatalog(canonicalItems, catalogId)
  const count = canonicalCatalogCount(canonicalItems, catalogId)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState<CatalogRemoveBusyState>(() =>
    createCatalogRemoveBusyState(catalogId),
  )
  const [crudBusy, setCrudBusy] = useState(false)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [playHint, setPlayHint] = useState<string | null>(null)
  const playGeneration = useRef(0)
  /** Синхронный gate: React busyKey ещё не успевает при быстрых повторных Play. */
  const playBusyRef = useRef(false)
  const playMountedRef = useRef(true)
  const fullscreenOpenedForPlayRef = useRef(false)
  const crudBusyRef = useRef(false)
  /**
   * Синхронный gate in-flight: ключ `${generation}:${trackId}`,
   * чтобы stale DELETE каталога A не блокировал тот же trackId в B.
   */
  const removeBusyIdsRef = useRef<Set<string>>(new Set())
  const removeMountedRef = useRef(true)

  if (removeBusy.catalogId !== catalogId) {
    setRemoveBusy(switchCatalogRemoveBusyState(removeBusy, catalogId))
  }

  useEffect(() => {
    removeMountedRef.current = true
    return () => {
      removeMountedRef.current = false
      removeBusyIdsRef.current = new Set()
    }
  }, [])

  // LIB-06: смена аккаунта не оставляет залипшие busy на DELETE прошлого пользователя.
  useEffect(() => {
    setRemoveBusy(createCatalogRemoveBusyState(catalogId))
    removeBusyIdsRef.current = new Set()
    setCrudBusy(false)
    crudBusyRef.current = false
    setCrudError(null)
  }, [authUserId, catalogId])

  useEffect(() => {
    playMountedRef.current = true
    return () => {
      playMountedRef.current = false
      playGeneration.current += 1
      playBusyRef.current = false
      fullscreenOpenedForPlayRef.current = false
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

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || crudBusyRef.current) {
      return
    }
    crudBusyRef.current = true
    setCrudBusy(true)
    setCrudError(null)
    try {
      await updateCategoryConfirmed(catalog.id, { name: trimmed })
      setRenaming(false)
      setCrudError(null)
    } catch (error) {
      if (!isRetryableCategoryCreateError(error)) {
        setRenaming(false)
        setCrudError(null)
        return
      }
      if (
        error instanceof CatalogSyncAmbiguousError ||
        isAmbiguousCatalogTransportError(error)
      ) {
        setCrudError(
          error instanceof CatalogSyncAmbiguousError
            ? error.message
            : `${SAVE_FAILED_MESSAGE} Результат переименования не подтверждён.`,
        )
        return
      }
      setCrudError(`${SAVE_FAILED_MESSAGE} Имя не изменено — можно повторить.`)
    } finally {
      crudBusyRef.current = false
      setCrudBusy(false)
    }
  }

  const confirmDeleteCatalog = async () => {
    if (crudBusyRef.current) {
      return
    }
    crudBusyRef.current = true
    setCrudBusy(true)
    setCrudError(null)
    try {
      await deleteCategoryConfirmed(catalog.id)
      setRemoved(true)
      navigate('/library')
    } catch (error) {
      if (!isRetryableCategoryCreateError(error)) {
        setConfirmDelete(false)
        setCrudError(null)
        return
      }
      if (
        error instanceof CatalogSyncAmbiguousError ||
        isAmbiguousCatalogTransportError(error)
      ) {
        setCrudError(
          error instanceof CatalogSyncAmbiguousError
            ? error.message
            : `${SAVE_FAILED_MESSAGE} Результат удаления не подтверждён.`,
        )
        return
      }
      setCrudError(`${SAVE_FAILED_MESSAGE} Каталог не удалён — можно повторить.`)
    } finally {
      crudBusyRef.current = false
      setCrudBusy(false)
    }
  }

  const runPlay = async (startCanonicalTrackId?: string) => {
    if (busyKey || playBusyRef.current) {
      setPlayError(CATALOG_PLAYBACK_MESSAGE.BUSY)
      return
    }
    playBusyRef.current = true
    const generation = ++playGeneration.current
    fullscreenOpenedForPlayRef.current = false
    const key = startCanonicalTrackId ?? 'catalog'
    setBusyKey(key)
    setPlayError(null)
    setPlayHint(null)

    const openFullscreenIfCurrent = (needsUserPlayGesture?: boolean) => {
      if (generation !== playGeneration.current || !playMountedRef.current) {
        return
      }
      if (fullscreenOpenedForPlayRef.current) {
        return
      }
      fullscreenOpenedForPlayRef.current = true
      setPlayError(null)
      if (needsUserPlayGesture) {
        setPlayHint(CATALOG_PLAYBACK_MESSAGE.NEEDS_USER_PLAY)
      }
      // Сразу после принятия первого playback intent — не ждать prepare всей очереди.
      openFullscreenPlayer(navigate, location)
    }

    try {
      const result = await playUserCatalog(
        {
          catalog: { id: catalog.id, name: catalog.name },
          items: tracks,
          startCanonicalTrackId,
        },
        {
          onPlaybackAccepted: (info) => {
            openFullscreenIfCurrent(info.needsUserPlayGesture)
          },
        },
      )
      if (generation !== playGeneration.current || !playMountedRef.current) {
        return
      }
      if (
        result.status === 'played' &&
        shouldOpenFullscreenAfterCatalogPlay(result)
      ) {
        if (result.needsUserPlayGesture) {
          setPlayHint(CATALOG_PLAYBACK_MESSAGE.NEEDS_USER_PLAY)
        }
        // Fallback: early-path без callback или повторный open no-op.
        openFullscreenIfCurrent(result.needsUserPlayGesture)
        return
      }
      if (result.status !== 'played') {
        setPlayError(result.message)
      }
    } catch {
      if (generation === playGeneration.current && playMountedRef.current) {
        setPlayError(CATALOG_PLAYBACK_MESSAGE.FAILED)
      }
    } finally {
      if (generation === playGeneration.current) {
        setBusyKey(null)
        playBusyRef.current = false
      }
    }
  }

  const catalogBusy = busyKey === 'catalog'
  const anyBusy = busyKey !== null || crudBusy

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

      {crudError ? (
        <p
          className="rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100"
          role="alert"
        >
          {crudError}
        </p>
      ) : null}

      {renaming ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void saveName()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Новое название каталога"
            disabled={crudBusy}
            className="min-h-11 min-w-[12rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm disabled:opacity-60"
            autoFocus
          />
          <button
            type="submit"
            disabled={crudBusy || !name.trim()}
            aria-busy={crudBusy || undefined}
            className="min-h-11 rounded-xl bg-[var(--color-accent)] px-3 text-sm font-medium text-white disabled:opacity-40"
          >
            {crudBusy ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm disabled:opacity-40"
            disabled={crudBusy}
            onClick={() => {
              setRenaming(false)
              setCrudError(null)
            }}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm disabled:opacity-40"
            disabled={crudBusy}
            onClick={() => {
              setName(catalog.name)
              setRenaming(true)
              setConfirmDelete(false)
              setCrudError(null)
            }}
          >
            Переименовать
          </button>
          {canDeleteCatalog(catalog) ? (
            <button
              type="button"
              className="min-h-11 rounded-xl border border-rose-400 px-3 text-sm text-rose-700 dark:text-rose-300 disabled:opacity-40"
              disabled={crudBusy}
              onClick={() => {
                setConfirmDelete(true)
                setCrudError(null)
              }}
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
              className="min-h-11 rounded-xl bg-rose-600 px-3 text-sm font-medium text-white disabled:opacity-40"
              disabled={crudBusy}
              aria-busy={crudBusy || undefined}
              onClick={() => {
                void confirmDeleteCatalog()
              }}
            >
              {crudBusy ? 'Удаление…' : 'Удалить'}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm disabled:opacity-40"
              disabled={crudBusy}
              onClick={() => {
                setConfirmDelete(false)
                setCrudError(null)
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {removeBusy.error ? (
        <p
          className="rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100"
          role="alert"
        >
          {removeBusy.error}
        </p>
      ) : null}

      {tracks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-muted)]">
          В этом каталоге пока нет треков
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((item) => {
            const rowBusy = busyKey === item.canonicalTrack.id
            const trackRemoveBusy = removeBusy.busyIds.has(item.canonicalTrack.id)
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
                  className="min-h-11 shrink-0 rounded-xl border border-[var(--color-border)] px-2 text-xs disabled:opacity-40 sm:px-3"
                  aria-label={`Убрать «${item.canonicalTrack.title}» из каталога`}
                  aria-busy={trackRemoveBusy || undefined}
                  disabled={trackRemoveBusy}
                  onClick={() => {
                    const id = item.canonicalTrack.id
                    if (removeBusy.catalogId !== catalogId) {
                      return
                    }
                    const contextAtStart = getCatalogRemoveContext(removeBusy)
                    const flightKey = `${contextAtStart.generation}:${id}`
                    if (removeBusyIdsRef.current.has(flightKey)) {
                      return
                    }
                    const started = beginCatalogTrackRemove(removeBusy, id)
                    if (!started.started) {
                      return
                    }
                    removeBusyIdsRef.current.add(flightKey)
                    setRemoveBusy(started.state)
                    const sessionAtStart = captureAuthSession()
                    void removeCanonicalFromCatalog(id, catalog.id).then((ok) => {
                      setRemoveBusy((current) => {
                        const next = applyCatalogRemoveResult(current, {
                          canonicalTrackId: id,
                          ok,
                          mounted: removeMountedRef.current,
                          sessionAtStart,
                          contextAtStart,
                          failureMessage: `${SAVE_FAILED_MESSAGE} Не удалось убрать из каталога — можно повторить.`,
                        })
                        if (next !== current) {
                          removeBusyIdsRef.current.delete(flightKey)
                        }
                        return next
                      })
                    })
                  }}
                >
                  {trackRemoveBusy ? (
                    'Удаление…'
                  ) : (
                    <>
                      <span className="sm:hidden">Убрать</span>
                      <span className="hidden sm:inline">Убрать из каталога</span>
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
