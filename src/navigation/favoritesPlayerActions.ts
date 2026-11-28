import { gestureActionLabels } from '../config/gestureConfig.ts'
import {
  itemHasUserCatalogMembership,
  itemInSwipeInbox,
} from '../services/catalogs/systemFolders.ts'
import type { CanonicalLibraryItem } from '../types/canonical.ts'
import type { GestureConfig, SwipeDirection } from '../types/gesture.ts'

const DIRECTION_ORDER: readonly SwipeDirection[] = [
  'left',
  'right',
  'up',
  'down',
]

const ARROW: Record<SwipeDirection, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
}

/**
 * Нужно ли разрешить Like для уже liked трека: ещё не в user-каталоге
 * и не в sys_swipes — идемпотентно дописать inbox.
 */
export function needsSwipeInboxEnsure(
  item: Pick<CanonicalLibraryItem, 'catalogIds'> | null | undefined,
): boolean {
  if (!item) {
    return true
  }
  if (itemHasUserCatalogMembership(item)) {
    return false
  }
  if (itemInSwipeInbox(item)) {
    return false
  }
  return true
}

/** Подсказка жестов Избранного строго из gestureConfig. */
export function formatFavoritesGestureHint(config: GestureConfig): string {
  const parts = DIRECTION_ORDER.map((direction) => {
    const action = config[direction]
    return `${ARROW[direction]} ${gestureActionLabels[action]}`
  })
  return `Жесты: ${parts.join(' · ')}. Зеркало источника не меняется.`
}

export type FavoritesLikeNotice =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export function resolveFavoritesLikeNotice(input: {
  savedOk: boolean
  saveFailedMessage: string
}): FavoritesLikeNotice {
  if (input.savedOk) {
    return {
      kind: 'success',
      message:
        'Добавлено в «Свайпы». В Избранном источника трек остаётся.',
    }
  }
  return { kind: 'error', message: input.saveFailedMessage }
}
