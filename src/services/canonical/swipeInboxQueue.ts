import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { sourceTrackKeyOf } from './mapCanonical.ts'

/**
 * После полного успеха разбора: убрать композицию из будущих циклов sys_swipes.
 * Ищем очередь по canonicalTrackId (любая SourceCopy), не по preferred list id.
 * Чужой playlist / search / wave не трогаем.
 */
export function removeSortedCanonicalFromSwipesQueue(
  canonicalTrackId: string,
): void {
  if (!canonicalTrackId) {
    return
  }
  const queue = getPlaybackQueue()
  const context = queue.getPlaybackContext()
  if (context.type !== 'playlist' || context.id !== SYS_SWIPES_ID) {
    return
  }

  const playbackTrackId = findQueueTrackIdForCanonical(canonicalTrackId)
  if (!playbackTrackId) {
    return
  }
  queue.removePreservingCurrentPlayback(playbackTrackId)
}

export function findQueueTrackIdForCanonical(
  canonicalTrackId: string,
): string | null {
  const queue = getPlaybackQueue()
  const store = useCanonicalLibraryStore.getState()
  const item = store.itemsById[canonicalTrackId]
  const keys = new Set<string>()
  if (item) {
    for (const copy of item.copies) {
      keys.add(copy.sourceTrackKey)
    }
  }
  for (const [key, id] of Object.entries(store.sourceKeyToCanonicalId)) {
    if (id === canonicalTrackId) {
      keys.add(key)
    }
  }

  for (const track of queue.getItems()) {
    const key = sourceTrackKeyOf(track)
    if (
      keys.has(track.id) ||
      keys.has(key) ||
      store.sourceKeyToCanonicalId[key] === canonicalTrackId ||
      store.sourceKeyToCanonicalId[track.id] === canonicalTrackId
    ) {
      return track.id
    }
  }
  return null
}
