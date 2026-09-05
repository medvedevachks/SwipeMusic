import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from './types'
import type { MusicSource } from '../types/musicSource'

/**
 * Единый контракт любого источника музыки.
 * Новые поставщики подключаются адаптером — без правок SwipeDeck / store.
 */
export interface MusicSourceAdapter extends MusicSource {
  readonly id: string
  readonly label: string
  readonly kind: MusicSourceKind
  readonly capabilities: readonly MusicSourceCapability[]

  /** Готов ли источник к выдаче треков (авторизация, доступ к папке и т.п.). */
  isAvailable(): boolean | Promise<boolean>

  /**
   * Основной метод ленты / коллекции.
   * Все источники обязаны уметь отдавать треки в каноническом формате Track.
   */
  fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult>

  /** Опциональный поиск — если есть capability `search`. */
  search?(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<FetchTracksResult>

  /** Освобождение ресурсов (watchers, токены, соединения). */
  dispose?(): void | Promise<void>
}

export type MusicSourceAdapterFactory = () => MusicSourceAdapter
