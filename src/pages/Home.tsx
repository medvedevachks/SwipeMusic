import { useCallback, useEffect, useState } from 'react'
import { AlbumModeBanner } from '../components/AlbumModeBanner'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import SwipeDeck from '../components/SwipeDeck'
import { useSwipeFeed } from '../hooks/useSwipeFeed'
import { commitCatalogChoice } from '../services/canonical/userOrganization.ts'
import { getPlaybackIntent } from '../services/playbackIntent'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import { isQueueLockedContext } from '../types/playbackContext'
import type { Track } from '../types/track'

export default function Home() {
  const { tracks, isLoading, error, mode, searchQuery } = useSwipeFeed()
  const resetToCatalog = useSwipeDeckSessionStore((state) => state.resetToCatalog)
  const gestureConfig = useCollectionStore((state) => state.gestureConfig)
  const categories = useCollectionStore((state) => state.categories)
  const createCategory = useCollectionStore((state) => state.createCategory)

  const setQueue = usePlayerStore((state) => state.setQueue)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const playerError = usePlayerStore((state) => state.error)
  const seek = usePlayerStore((state) => state.seek)
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const pendingPlaybackTrack = usePlayerStore((state) => state.pendingTrack)
  const playbackContext = usePlayerStore((state) => state.playbackContext)
  const queueLocked = isQueueLockedContext(playbackContext)

  const [pendingTrack, setPendingTrack] = useState<Track | null>(null)
  const [categoryResolveKey, setCategoryResolveKey] = useState(0)
  const [categoryCancelKey, setCategoryCancelKey] = useState(0)

  useEffect(() => {
    if (queueLocked) {
      return
    }
    if (tracks.length === 0) {
      return
    }
    if (usePlayerStore.getState().queue.length > 0) {
      return
    }
    setQueue(tracks, 0, { type: 'swipe' })
  }, [tracks, setQueue, queueLocked])

  const playDeckTrack = useCallback(
    (track: Track) => {
      const startIndex = tracks.findIndex((item) => item.id === track.id)
      if (startIndex < 0) {
        return
      }
      void getPlaybackIntent()
        .playFromSwipe({
          tracks,
          startIndex,
          explicitUserPlay: true,
        })
        .catch(() => {
          // resolve / autoplay — BottomPlayer
        })
    },
    [tracks],
  )

  const exitAlbumMode = useCallback(() => {
    const playerState = usePlayerStore.getState()
    getPlaybackIntent().exitAlbumMode({
      swipeTracks: tracks,
      currentTrack: playerState.pendingTrack ?? playerState.currentTrack,
    })
  }, [tracks])

  const deckKey =
    mode === 'search'
      ? `search:${searchQuery ?? ''}:${tracks[0]?.id ?? 'empty'}`
      : `catalog:${tracks[0]?.id ?? 'empty'}`

  return (
    <div className="space-y-5 pb-6">
      <div className="space-y-1 px-1 text-center sm:text-left">
        <p className="text-sm text-[var(--color-muted)]">
          {mode === 'search' && searchQuery
            ? `Результаты: «${searchQuery}»`
            : 'Свайп оценивает трек. Дальше / Назад также переключают плеер.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
            Сортировка
          </h1>
          {mode === 'search' && (
            <button
              type="button"
              className="rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)]"
              onClick={() => resetToCatalog()}
            >
              Сбросить поиск
            </button>
          )}
        </div>
      </div>

      {playbackContext.type === 'album' ? (
        <AlbumModeBanner
          title={playbackContext.title}
          artist={playbackContext.artist}
          onExit={exitAlbumMode}
        />
      ) : null}

      {isLoading ? (
        <p className="py-20 text-center text-sm text-[var(--color-muted)]">
          Загрузка коллекции…
        </p>
      ) : error ? (
        <p className="py-20 text-center text-sm text-rose-600">{error}</p>
      ) : (
        <SwipeDeck
          key={deckKey}
          tracks={tracks}
          gestureConfig={gestureConfig}
          categoryResolveKey={categoryResolveKey}
          categoryCancelKey={categoryCancelKey}
          playerTrackId={(pendingPlaybackTrack ?? currentTrack)?.id ?? null}
          playback={{
            currentTime,
            duration,
            canSeek: Boolean(currentTrack),
            onSeek: seek,
            error: playerError,
          }}
          onDeckNavigate={playDeckTrack}
          onCategorize={(track) => {
            setPendingTrack(track)
          }}
        />
      )}

      <CategoryPickerSheet
        open={pendingTrack !== null}
        trackTitle={pendingTrack?.title}
        categories={categories}
        onClose={() => {
          setPendingTrack(null)
          setCategoryCancelKey((value) => value + 1)
        }}
        onCreateCategory={createCategory}
        onSelect={(categoryId) => {
          if (!pendingTrack) {
            return
          }

          const track = pendingTrack
          const category = useCollectionStore
            .getState()
            .categories.find((item) => item.id === categoryId)
          setPendingTrack(null)
          setCategoryResolveKey((value) => value + 1)
          void commitCatalogChoice(track, categoryId, category)
        }}
      />
    </div>
  )
}
