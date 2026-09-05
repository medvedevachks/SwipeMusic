import type { Category } from './category'
import type { SwipeAction } from './swipe'
import type { Track } from './track'

/**
 * Запись истории действий пользователя.
 * Нужна для Undo, статистики и обучения рекомендаций.
 */
export type HistoryEntry = {
  id: string
  track: Track
  action: SwipeAction
  /** Категория на момент действия (если categorize). */
  category?: Category
  createdAt: string
  sourceId: string
}
