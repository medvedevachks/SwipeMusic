import { useState } from 'react'
import CategoryPickerSheet from '../components/CategoryPickerSheet'
import SwipeDeck from '../components/SwipeDeck'
import { useSwipeFeed } from '../hooks/useSwipeFeed'
import { useCollectionStore } from '../store/collectionStore'
import type { Track } from '../types/track'

export default function Home() {
  const { tracks, isLoading, error } = useSwipeFeed()
  const gestureConfig = useCollectionStore((state) => state.gestureConfig)
  const categories = useCollectionStore((state) => state.categories)
  const createCategory = useCollectionStore((state) => state.createCategory)
  const assignTrackToCategory = useCollectionStore(
    (state) => state.assignTrackToCategory,
  )
  const likeTrack = useCollectionStore((state) => state.likeTrack)
  const pushViewedTrack = useCollectionStore((state) => state.pushViewedTrack)

  const [pendingTrack, setPendingTrack] = useState<Track | null>(null)
  const [categoryResolveKey, setCategoryResolveKey] = useState(0)
  const [categoryCancelKey, setCategoryCancelKey] = useState(0)

  return (
    <div className="space-y-6 pb-6">
      <div className="space-y-1 px-1 text-center sm:text-left">
        <p className="text-sm text-[var(--color-muted)]">
          Быстро раскладывай треки по своим категориям
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
          Сортировка
        </h1>
      </div>

      {isLoading ? (
        <p className="py-20 text-center text-sm text-[var(--color-muted)]">
          Загрузка коллекции…
        </p>
      ) : error ? (
        <p className="py-20 text-center text-sm text-rose-600">{error}</p>
      ) : (
        <SwipeDeck
          tracks={tracks}
          gestureConfig={gestureConfig}
          categoryResolveKey={categoryResolveKey}
          categoryCancelKey={categoryCancelKey}
          onCategorize={(track) => {
            pushViewedTrack(track.id)
            setPendingTrack(track)
          }}
          onLike={(track) => {
            pushViewedTrack(track.id)
            likeTrack(track.id)
          }}
          onSkip={(track) => {
            pushViewedTrack(track.id)
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

          assignTrackToCategory(pendingTrack.id, categoryId)
          setPendingTrack(null)
          setCategoryResolveKey((value) => value + 1)
        }}
      />
    </div>
  )
}
