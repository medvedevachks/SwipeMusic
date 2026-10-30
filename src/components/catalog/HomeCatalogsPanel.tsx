import { useCallback, useRef, useState } from 'react'
import {
  CATALOG_PLAYBACK_MESSAGE,
  cancelCatalogPlaybackGate,
  playUserCatalog,
} from '../../services/catalogPlayback'
import {
  canonicalTracksInCatalog,
  listCanonicalItems,
} from '../../services/canonical/selectors'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { usePlayerStore } from '../../store/playerStore'
import type { Catalog } from '../../types/category'
import { CatalogList } from './CatalogList'

/**
 * Самостоятельный UI-сценарий вкладки «Каталоги».
 * Не проходит через HomeStage / SwipeDeck / Recommendation Engine.
 */
export function HomeCatalogsPanel() {
  const playbackContext = usePlayerStore((state) => state.playbackContext)
  const [busyCatalogId, setBusyCatalogId] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [playHint, setPlayHint] = useState<string | null>(null)
  const playGeneration = useRef(0)

  const activeCatalogId =
    playbackContext.type === 'playlist' ? playbackContext.id : null

  const onPlayCatalog = useCallback(async (catalog: Catalog) => {
    const generation = ++playGeneration.current
    // Повторный/другой каталог: отменяем устаревшую фоновую подготовку, звук не трогаем.
    cancelCatalogPlaybackGate()
    setBusyCatalogId(catalog.id)
    setPlayError(null)
    setPlayHint(null)

    const canonicalItems = listCanonicalItems(
      Object.values(useCanonicalLibraryStore.getState().itemsById),
    )
    const items = canonicalTracksInCatalog(canonicalItems, catalog.id)

    try {
      const result = await playUserCatalog({
        catalog: { id: catalog.id, name: catalog.name },
        items,
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
        setBusyCatalogId(null)
      }
    }
  }, [])

  return (
    <div className="space-y-3 px-1">
      <CatalogList
        mode="play"
        heading="Каталоги"
        showCreate={false}
        activeCatalogId={activeCatalogId}
        busyCatalogId={busyCatalogId}
        onPlayCatalog={(catalog) => {
          void onPlayCatalog(catalog)
        }}
      />
      {playHint ? (
        <p className="text-sm text-[var(--color-muted)]" role="status">
          {playHint}
        </p>
      ) : null}
      {playError ? (
        <p className="text-sm text-rose-600" role="alert">
          {playError}
        </p>
      ) : null}
    </div>
  )
}
