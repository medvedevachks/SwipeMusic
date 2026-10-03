import type { Catalog } from './category'
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
  /**
   * Снимок каталога на момент действия.
   * Имя поля `category` сохранено: так уже лежат записи в SQLite.
   */
  category?: Catalog
  createdAt: string
  sourceId: string
}
