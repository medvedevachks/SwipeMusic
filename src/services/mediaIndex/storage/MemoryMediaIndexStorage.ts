import type { TrackRecord } from '../types'
import type { MediaIndexStorage } from './MediaIndexStorage'

export class MemoryMediaIndexStorage implements MediaIndexStorage {
  private records: TrackRecord[] = []

  async load(): Promise<TrackRecord[]> {
    return [...this.records]
  }

  async save(records: TrackRecord[]): Promise<void> {
    this.records = [...records]
  }

  async clear(): Promise<void> {
    this.records = []
  }
}
