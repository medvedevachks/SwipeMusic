import type { Track } from './track'

export type SearchEngineStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * Состояние SearchEngine (сервисный слой).
 * UI читает зеркало через searchStore.
 */
export type SearchEngineState = {
  query: string
  status: SearchEngineStatus
  results: Track[]
  error: string | null
  activeSourceIds: string[]
  lastSearchTime: number | null
  /** Есть ли ещё страницы хотя бы у одного провайдера. */
  hasMore: boolean
  /** Идёт подгрузка следующей страницы (результаты уже на экране). */
  loadingMore: boolean
  /** Ключ кэша последнего успешного запроса (включая частичную выдачу). */
  cacheKey: string | null
}
