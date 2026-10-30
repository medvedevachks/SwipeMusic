import { commitSwipeLikeWithInbox } from '../canonical/swipeInbox.ts'
import { sourceTrackKeyOf } from '../canonical/mapCanonical.ts'
import { isSourceCopyLiked } from '../canonical/selectors.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionEngineStore } from '../../store/collectionEngineStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import type { SwipeAction } from '../../types/swipe'
import type { Track } from '../../types/track'
import {
  beginPendingSwipeLike,
  endPendingSwipeLike,
  hasPendingSwipeLike,
} from './pendingSwipeLike.ts'

export type ClassifySwipeResult =
  | { kind: 'applied'; action: SwipeAction; saved?: Promise<boolean> }
  | { kind: 'needsCategory'; action: 'categorize' }

export type ClassifySwipeDeps = {
  /** Подмена сохранения лайка (тесты: управляемый pending Promise). */
  commitLike?: (track: Track) => Promise<boolean>
}

/**
 * Единый semantic handler классификации свайпа.
 * Не трогает playback / queue / context.
 * like → liked + sys_swipes (накопитель). skip → skipped, без inbox.
 * UP после лайка / pending-like: только навигация — без markSkipped / history-skip.
 */
export function classifySwipeTrack(
  track: Track,
  action: SwipeAction,
  deps: ClassifySwipeDeps = {},
): ClassifySwipeResult {
  const collection = useCollectionStore.getState()
  const engine = useCollectionEngineStore.getState()

  collection.pushViewedTrack(track.id)

  switch (action) {
    case 'like': {
      const key = sourceTrackKeyOf(track)
      // Intent до await: быстрый UP не должен писать skip.
      // Token сессии: finally A не снимает pending B после logout/login.
      const likeSession = beginPendingSwipeLike(key)
      const commit = deps.commitLike ?? commitSwipeLikeWithInbox
      const saved = commit(track).finally(() => {
        endPendingSwipeLike(key, likeSession)
      })
      return { kind: 'applied', action, saved }
    }

    case 'skip': {
      const key = sourceTrackKeyOf(track)
      const alreadyLiked = isSourceCopyLiked(
        useCanonicalLibraryStore.getState(),
        key,
      )
      if (alreadyLiked || hasPendingSwipeLike(key)) {
        // Понравившаяся / только что лайкнутая: UP = «следующая», не негативный skip.
        return { kind: 'applied', action }
      }
      // Не лайкнута: согласованная семантика пропуска. В sys_swipes НЕ добавляем.
      collection.recordHistory({ track, action: 'skip' })
      engine.markSkipped(track.id, track)
      return { kind: 'applied', action }
    }

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
