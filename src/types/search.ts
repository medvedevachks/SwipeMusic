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
  /** Заготовка под постраничную загрузку. */
  hasMore: boolean
  /** Заготовка под кэш: ключ последнего успешного запроса. */
  cacheKey: string | null
}
