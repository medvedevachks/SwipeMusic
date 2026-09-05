import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceDescriptor,
  MusicSourceKind,
} from './types'

/**
 * Единый контракт любого источника музыки.
 * Новые поставщики подключаются адаптером — без правок SwipeDeck / store.
 */
export interface MusicSourceAdapter extends MusicSourceDescriptor {
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
