import { commitSwipeLikeWithInbox } from '../canonical/swipeInbox.ts'
import { useCollectionEngineStore } from '../../store/collectionEngineStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import type { SwipeAction } from '../../types/swipe'
import type { Track } from '../../types/track'

export type ClassifySwipeResult =
  | { kind: 'applied'; action: SwipeAction; saved?: Promise<boolean> }
  | { kind: 'needsCategory'; action: 'categorize' }

/**
 * Единый semantic handler классификации свайпа.
 * Не трогает playback / queue / context.
 * like → liked + sys_swipes (накопитель). skip → skipped, без inbox.
 */
export function classifySwipeTrack(
  track: Track,
  action: SwipeAction,
): ClassifySwipeResult {
  const collection = useCollectionStore.getState()
  const engine = useCollectionEngineStore.getState()

  collection.pushViewedTrack(track.id)

  switch (action) {
    case 'like':
      // Один liked + membership sys_swipes. Не markSkipped.
      return { kind: 'applied', action, saved: commitSwipeLikeWithInbox(track) }

    case 'skip':
      // «Дальше»: прежняя семантика skipped. В sys_swipes НЕ добавляем.
      collection.recordHistory({ track, action: 'skip' })
      engine.markSkipped(track.id, track)
      return { kind: 'applied', action }

    case 'categorize':
      return { kind: 'needsCategory', action: 'categorize' }

    case 'previous':
      collection.recordHistory({ track, action: 'previous' })
      return { kind: 'applied', action }

    default: {
      const _exhaustive: never = action
      void _exhaustive
      return { kind: 'applied', action }
    }
  }
}
