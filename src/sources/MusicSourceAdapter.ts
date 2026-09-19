import type {
  FetchTracksParams,
  FetchTracksResult,
  ManualSourceEntryInput,
  MusicSourceCapability,
  MusicSourceDescriptor,
  MusicSourceKind,
} from './types'
import type { SourceTrack, Track } from '../types/track'

/**
 * Единый контракт любого источника музыки.
 * Новые поставщики подключаются адаптером — без правок SwipeDeck / store.
 */
export interface MusicSourceAdapter extends MusicSourceDescriptor {
  readonly id: string
  readonly label: string
  readonly kind: MusicSourceKind
  readonly capabilities: readonly MusicSourceCapability[]
  readonly connectionNote: string

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

  createManualEntry?(input: ManualSourceEntryInput): SourceTrack

  canPlay(track: Track): boolean

  openExternal?(track: Track): void

  /** Освобождение ресурсов (watchers, токены, соединения). */
  dispose?(): void | Promise<void>
}

export type MusicSourceAdapterFactory = () => MusicSourceAdapter
