import { useCallback, useEffect, useState } from 'react'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import SwipeDeck from '../components/SwipeDeck'
import { useSwipeFeed } from '../hooks/useSwipeFeed'
import { useCollectionEngineStore } from '../store/collectionEngineStore'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'
import { useSwipeDeckSessionStore } from '../store/swipeDeckSessionStore'
import type { Track } from '../types/track'

export default function Home() {
  const { tracks, isLoading, error, mode, searchQuery } = useSwipeFeed()
  const resetToCatalog = useSwipeDeckSessionStore((state) => state.resetToCatalog)
  const gestureConfig = useCollectionStore((state) => state.gestureConfig)
  const categories = useCollectionStore((state) => state.categories)
  const createCategory = useCollectionStore((state) => state.createCategory)
  const assignTrackToCategory = useCollectionStore(
    (state) => state.assignTrackToCategory,
  )
  const likeTrack = useCollectionStore((state) => state.likeTrack)
  const pushViewedTrack = useCollectionStore((state) => state.pushViewedTrack)
  const recordHistory = useCollectionStore((state) => state.recordHistory)

  const collectionAssignCategory = useCollectionEngineStore(
    (state) => state.assignCategory,
  )
  const collectionSetLiked = useCollectionEngineStore((state) => state.setLiked)
  const collectionMarkSkipped = useCollectionEngineStore((state) => state.markSkipped)
  const collectionMarkPlayed = useCollectionEngineStore((state) => state.markPlayed)

  const setQueue = usePlayerStore((state) => state.setQueue)
  const playTrack = usePlayerStore((state) => state.playTrack)

  const [pendingTrack, setPendingTrack] = useState<Track | null>(null)
  const [categoryResolveKey, setCategoryResolveKey] = useState(0)
  const [categoryCancelKey, setCategoryCancelKey] = useState(0)

  useEffect(() => {
    if (tracks.length > 0) {
      setQueue(tracks, 0)
    }
  }, [tracks, setQueue])

  const handleCurrentTrackChange = useCallback(
    (track: Track | null) => {
      if (!track) {
        return
      }
      void playTrack(track)
        .then(() => {
          collectionMarkPlayed(track.id, track)
        })
        .catch(() => {
          // Автоплей может быть заблокирован до жеста пользователя — это нормально.
        })
    },
    [collectionMarkPlayed, playTrack],
  )

  const deckKey =
    mode === 'search'
      ? `search:${searchQuery ?? ''}:${tracks[0]?.id ?? 'empty'}`
      : `catalog:${tracks[0]?.id ?? 'empty'}`

  return (
    <div className="space-y-6 pb-6">
      <div className="space-y-1 px-1 text-center sm:text-left">
        <p className="text-sm text-[var(--color-muted)]">
          {mode === 'search' && searchQuery
            ? `Результаты: «${searchQuery}»`
            : 'Быстро раскладывай треки по своим категориям'}
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
          onCurrentTrackChange={handleCurrentTrackChange}
          onCategorize={(track) => {
            pushViewedTrack(track.id)
            setPendingTrack(track)
          }}
          onLike={(track) => {
            pushViewedTrack(track.id)
            likeTrack(track.id)
            recordHistory({ track, action: 'like' })
            collectionSetLiked(track.id, true, track)
          }}
          onSkip={(track) => {
            pushViewedTrack(track.id)
            recordHistory({ track, action: 'skip' })
            collectionMarkSkipped(track.id, track)
          }}
          onPrevious={(track) => {
            recordHistory({ track, action: 'previous' })
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

          const category = categories.find((item) => item.id === categoryId)
          assignTrackToCategory(pendingTrack.id, categoryId)
          recordHistory({
            track: pendingTrack,
            action: 'categorize',
            category,
          })
          collectionAssignCategory(pendingTrack.id, categoryId, pendingTrack)
          setPendingTrack(null)
          setCategoryResolveKey((value) => value + 1)
        }}
      />
    </div>
  )
}
