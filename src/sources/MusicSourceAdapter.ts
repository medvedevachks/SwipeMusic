import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from './types'
import type { MusicSource } from '../types/musicSource'
import type { SourceType } from '../types/source'
import type { Track } from '../types/track'

/** Результат поиска — тот же контракт, что и лента Track[]. */
export type SearchResult = FetchTracksResult

/**
 * Единый контракт любого источника музыки.
 * UI / Swipe / Search / Player не знают конкретных Spotify/Zaycev/FS.
 *
 * Существующие методы (initialize, fetchTracks, …) сохранены для совместимости.
 */
export interface MusicSourceAdapter extends MusicSource {
  readonly id: string
  readonly label: string
  readonly type: SourceType
  readonly kind: MusicSourceKind
  readonly capabilities: readonly MusicSourceCapability[]

  readonly supportsSearch: boolean
  readonly supportsStreaming: boolean
  readonly supportsPagination: boolean

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
  ): Promise<SearchResult>

  /** Один трек по внешнему или каноническому id. */
  getTrack(trackId: string): Promise<Track | null>

  /** URL потока / превью для плеера. */
  getStream(track: Track): Promise<string>

  /** URL обложки (если есть). */
  getCover(track: Track): Promise<string | undefined>

  /** Освобождение ресурсов. */
  dispose(): void | Promise<void>
}

export type MusicSourceAdapterFactory = () => MusicSourceAdapter
