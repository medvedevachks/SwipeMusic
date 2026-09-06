import type { TrackRecord } from '../types'

/**
 * Персистентное хранилище индекса.
 * Не знает про React / UI / ObjectURL.
 */
export interface MediaIndexStorage {
  load(): Promise<TrackRecord[]>
  save(records: TrackRecord[]): Promise<void>
  /** Опциональный partial update — default: full save. */
  upsert?(records: TrackRecord[]): Promise<void>
  remove?(ids: string[]): Promise<void>
  clear(): Promise<void>
}
