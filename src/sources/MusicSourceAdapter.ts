import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from './types'
import type { MusicSource } from '../types/musicSource'
import type { Track } from '../types/track'

/**
 * Единый контракт любого источника музыки.
 * Новые поставщики подключаются адаптером — без правок SwipeDeck / store / UI.
 */
export interface MusicSourceAdapter extends MusicSource {
  readonly id: string
  readonly label: string
  readonly kind: MusicSourceKind
  readonly capabilities: readonly MusicSourceCapability[]

  /** Подготовка адаптера (auth, FS handles и т.п.). */
  initialize(): void | Promise<void>

  /** Готов ли источник к выдаче треков. */
  isAvailable(): boolean | Promise<boolean>

  /** Лента / коллекция в каноническом формате Track. */
  fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult>

  /** Поиск по источнику. */
  search(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<FetchTracksResult>

  /** Один трек по внешнему или каноническому id. */
  getTrack(trackId: string): Promise<Track | null>

  /** Освобождение ресурсов. */
  dispose(): void | Promise<void>
}

export type MusicSourceAdapterFactory = () => MusicSourceAdapter
