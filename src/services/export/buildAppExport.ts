import { defaultGestureConfig } from '../../config/gestureConfig'
import { sourceManager } from '../../sources'
import { useCollectionStore } from '../../store/collectionStore'
import { getCollectionEngine } from '../collectionEngine'
import { exportService } from './ExportService'

/** Собирает полный JSON-экспорт из CollectionEngine + существующих stores. */
export function buildAppExportJson(): string {
  const engine = getCollectionEngine()
  const snapshot = engine.getSnapshot()
  const collectionState = useCollectionStore.getState()

  const likes = snapshot.tracks
    .filter((item) => item.liked)
    .map((item) => ({
      trackId: item.trackId,
      createdAt: item.addedAt,
    }))

  return exportService.exportJson({
    collection: snapshot.tracks,
    categories: collectionState.categories,
    likes,
    history: snapshot.actions,
    settings: {
      gestureConfig: collectionState.gestureConfig ?? defaultGestureConfig,
      collectionName: collectionState.collectionName,
    },
    sources: sourceManager.listSources(),
  })
}

export function downloadAppExportJson(filename = 'swipe-music-export.json'): void {
  const json = buildAppExportJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
