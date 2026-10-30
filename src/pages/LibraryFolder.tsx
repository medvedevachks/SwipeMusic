import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import { PlayIcon } from '../components/icons'
import { getCategoryGlyph } from '../config/categoryPresets'
import {
  canonicalTracksInCatalog,
  formatSourceCopyCount,
  likedCanonicalItems,
  listCanonicalItems,
  preferredTrackFromCanonical,
} from '../services/canonical/selectors'
import { removeSortedCanonicalFromSwipesQueue } from '../services/canonical/swipeInboxQueue'
import { startSwipeInboxSorting } from '../services/canonical/swipeInboxSorting'
import { commitCatalogChoice } from '../services/canonical/userOrganization'
import { sourceTrackKeyOf } from '../services/canonical/mapCanonical'
import { createCategoryConfirmed } from '../services/catalogs/createCategoryConfirmed'
import {
  CATALOG_PLAYBACK_MESSAGE,
  cancelCatalogPlaybackGate,
  playUserCatalog,
} from '../services/catalogPlayback'
import {
  LIBRARY_SYSTEM_FOLDERS,
  SYS_SWIPES_ID,
  listUserOrganizationCatalogs,
  type LibrarySystemFolderId,
} from '../services/catalogs/systemFolders'
import { SAVE_FAILED_MESSAGE } from '../services/libraryPersistence/statusStore'
import { useCanonicalLibraryStore } from '../store/canonicalLibraryStore'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'
import type { Track } from '../types/track'
import { getSourceDisplayName } from '../utils/sourceDisplay'

export type LibraryFolderProps = {
  folderId: LibrarySystemFolderId
}

export default function LibraryFolder({ folderId }: LibraryFolderProps) {
  const navigate = useNavigate()
  const folder = LIBRARY_SYSTEM_FOLDERS.find((row) => row.id === folderId)!
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const allCategories = useCollectionStore((state) => state.categories)
  const categories = useMemo(
    () => listUserOrganizationCatalogs(allCategories),
    [allCategories],
  )
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const playing = usePlayerStore((state) => state.playing)
  const playbackContext = usePlayerStore((state) => state.playbackContext)

  const items = listCanonicalItems(Object.values(itemsById))
  const tracks = useMemo(() => {
    switch (folderId) {
      case 'swipes':
        return canonicalTracksInCatalog(items, SYS_SWIPES_ID)
      case 'favorites':
        return likedCanonicalItems(items)
      case 'my-music':
        return items
      default: {
        const _exhaustive: never = folderId
        void _exhaustive
        return []
      }
    }
  }, [folderId, items])

  const catalogRef = useMemo(
    () => ({
      id:
        folderId === 'swipes'
          ? SYS_SWIPES_ID
          : folderId === 'favorites'
            ? 'sys_favorites'
            : 'sys_my_music',
      name: folder.name,
    }),
    [folderId, folder.name],
  )

  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [playHint, setPlayHint] = useState<string | null>(null)
  const [sortTrack, setSortTrack] = useState<Track | null>(null)
  const [sortCanonicalId, setSortCanonicalId] = useState<string | null>(null)
  const [sortNotice, setSortNotice] = useState<string | null>(null)
  const playGeneration = useRef(0)

  useEffect(() => {
    return () => {
      playGeneration.current += 1
      cancelCatalogPlaybackGate()
    }
  }, [folderId])

  const isThisPlaylistPlaying =
    playbackContext.type === 'playlist' &&
    playbackContext.id === catalogRef.id

  const runPlay = async (startCanonicalTrackId?: string) => {
    if (busyKey) {
      setPlayError(CATALOG_PLAYBACK_MESSAGE.BUSY)
      return
    }
    const generation = ++playGeneration.current
    const key = startCanonicalTrackId ?? 'folder'
    setBusyKey(key)
    setPlayError(null)
    setPlayHint(null)
    try {
      // UX-10: «Свайпы» → главная для разбора, не playlist-loop каталога.
      if (folderId === 'swipes') {
        const result = await startSwipeInboxSorting({
          startCanonicalTrackId,
          items: tracks,
        })
        if (generation !== playGeneration.current) {
          return
        }
        if (result.status === 'played') {
          setPlayError(null)
          navigate('/', { state: { focusHomeTab: 'sorting' } })
          return
        }
        setPlayError(result.message)
        return
      }

      const result = await playUserCatalog({
        catalog: catalogRef,
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

  const openSort = (itemCanonicalId: string) => {
    const item = tracks.find((row) => row.canonicalTrack.id === itemCanonicalId)
    if (!item) {
      return
    }
    // Для assign берём copy; для снятия с очереди — canonical id (см. onSelect).
    const playingCopy = currentTrack
      ? item.copies.find(
          (copy) =>
            copy.sourceTrackKey === currentTrack.id ||
            copy.sourceTrackKey === sourceTrackKeyOf(currentTrack),
        )
      : null
    const track = playingCopy
      ? {
          id: playingCopy.sourceTrackKey,
          sourceId: playingCopy.sourceId,
          externalId: playingCopy.externalId,
          title: playingCopy.title,
          artist: playingCopy.artist,
          album: playingCopy.album ?? undefined,
          durationMs: playingCopy.durationMs ?? undefined,
          coverUrl: playingCopy.artworkUrl ?? undefined,
        }
      : preferredTrackFromCanonical(item)
    if (!track) {
      return
    }
    setSortNotice(null)
    setSortCanonicalId(item.canonicalTrack.id)
    setSortTrack(track)
  }

  const openSortCurrent = () => {
    if (!currentTrack || !isThisPlaylistPlaying) {
      return
    }
    const key = sourceTrackKeyOf(currentTrack)
    const canonicalId =
      useCanonicalLibraryStore.getState().sourceKeyToCanonicalId[key] ??
      useCanonicalLibraryStore.getState().sourceKeyToCanonicalId[currentTrack.id] ??
      null
    setSortNotice(null)
    setSortCanonicalId(canonicalId)
    setSortTrack(currentTrack)
  }

  const folderBusy = busyKey === 'folder'
  const anyBusy = busyKey !== null
  const emptySwipes = folderId === 'swipes' && tracks.length === 0

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
          style={{ backgroundColor: folder.color }}
          aria-hidden="true"
        >
          {getCategoryGlyph(folder.icon)}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            {folder.name}
          </h1>
          <p className="text-sm text-[var(--color-muted)]">{folder.description}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-60"
          disabled={anyBusy || tracks.length === 0}
          aria-busy={folderBusy || undefined}
          aria-label={`Слушать «${folder.name}»`}
          onClick={() => {
            void runPlay()
          }}
        >
          {folderBusy ? (
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <PlayIcon className="h-5 w-5 translate-x-0.5" />
          )}
          Слушать
        </button>
        {folderId === 'swipes' && isThisPlaylistPlaying && currentTrack ? (
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm font-medium"
            onClick={openSortCurrent}
          >
            В каталог
          </button>
        ) : null}
      </div>

      {folderId === 'swipes' && isThisPlaylistPlaying && currentTrack ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Сейчас{playing ? '' : ' · пауза'}
          </p>
          <p className="mt-1 truncate text-base font-medium text-[var(--color-fg)]">
            {currentTrack.title}
          </p>
          <p className="truncate text-sm text-[var(--color-muted)]">
            {currentTrack.artist}
          </p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Управление — в нижнем плеере. Прослушивание не убирает песню из
            «Свайпов».
          </p>
        </div>
      ) : null}

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

      {sortNotice ? (
        <p
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]"
          role="status"
        >
          {sortNotice}
        </p>
      ) : null}

      {emptySwipes ? (
        <p className="py-8 text-center text-sm text-[var(--color-muted)]">
          Все композиции разобраны. Отмечайте понравившиеся свайпом влево — они
          появятся здесь.
        </p>
      ) : tracks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-muted)]">
          Пока пусто
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((item) => {
            const rowBusy = busyKey === item.canonicalTrack.id
            return (
              <li
                key={item.canonicalTrack.id}
                className="flex min-w-0 items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 sm:gap-3 sm:px-3 [content-visibility:auto] [contain-intrinsic-size:72px]"
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
                {folderId === 'swipes' ? (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 rounded-xl border border-[var(--color-border)] px-2 text-xs sm:px-3"
                    onClick={() => openSort(item.canonicalTrack.id)}
                  >
                    В каталог
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <CategoryPickerSheet
        open={sortTrack !== null}
        trackTitle={sortTrack?.title}
        categories={categories}
        onClose={() => {
          setSortTrack(null)
          setSortCanonicalId(null)
        }}
        onCreateCategory={createCategoryConfirmed}
        onSelect={(categoryId) => {
          if (!sortTrack) {
            return
          }
          const track = sortTrack
          const canonicalId = sortCanonicalId
          const category =
            useCollectionStore.getState().categories.find((item) => item.id === categoryId) ??
            allCategories.find((item) => item.id === categoryId)
          void commitCatalogChoice(track, categoryId, category).then((result) => {
            if (result.status === 'failed') {
              setSortNotice(SAVE_FAILED_MESSAGE)
              // sheet остаётся открытым для повтора.
              return
            }
            setSortTrack(null)
            setSortCanonicalId(null)
            if (result.status === 'partial') {
              setSortNotice(
                'Сохранено в каталог, но не удалось убрать из «Свайпов». Нажмите «В каталог» ещё раз.',
              )
              return
            }
            const id = result.canonicalTrackId ?? canonicalId
            if (id) {
              removeSortedCanonicalFromSwipesQueue(id)
            }
            setSortNotice(null)
          })
        }}
      />
    </section>
  )
}
