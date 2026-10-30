import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CatalogQueueEntry } from './buildCatalogPlaybackQueue.ts'

const VIRTUAL_FAVORITES_ID = 'sys_favorites'
const VIRTUAL_MY_MUSIC_ID = 'sys_my_music'

/**
 * Отсекает треки, уже ушедшие из каталога/папки после старта playUserCatalog
 * (пока шёл фоновый prepare). Не пишет membership — только фильтр очереди.
 */
export function filterQueueToLiveCatalogMembership(
  catalogId: string,
  queue: readonly CatalogQueueEntry[],
): CatalogQueueEntry[] {
  const store = useCanonicalLibraryStore.getState()
  return queue.filter((entry) => {
    const item = store.itemsById[entry.canonicalTrackId]
    if (!item) {
      // Нет live snapshot (тесты / до hydrate) — не выкидываем.
      return true
    }
    return itemStillInFolder(catalogId, item)
  })
}

export function filterItemsToLiveCatalogMembership(
  catalogId: string,
  items: readonly CanonicalLibraryItem[],
): CanonicalLibraryItem[] {
  const store = useCanonicalLibraryStore.getState()
  return items.filter((item) => {
    const live = store.itemsById[item.canonicalTrack.id]
    if (!live) {
      return true
    }
    return itemStillInFolder(catalogId, live)
  })
}

function itemStillInFolder(
  catalogId: string,
  item: CanonicalLibraryItem,
): boolean {
  if (catalogId === VIRTUAL_FAVORITES_ID) {
    return item.state.liked
  }
  if (catalogId === VIRTUAL_MY_MUSIC_ID) {
    return true
  }
  return item.catalogIds.includes(catalogId)
}
