import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'

/**
 * После успешного разбора из «Свайпов»: убрать из будущих циклов sys_swipes-очереди.
 * Current не останавливаем. Чужой playlist / search / wave не трогаем.
 */
export function removeSortedTrackFromSwipesQueue(trackId: string): void {
  const queue = getPlaybackQueue()
  const context = queue.getPlaybackContext()
  if (context.type !== 'playlist' || context.id !== SYS_SWIPES_ID) {
    return
  }
  queue.removePreservingCurrentPlayback(trackId)
}
