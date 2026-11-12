/**
 * In-memory cache результата Prepare.
 * Не пишет playback URL в localStorage / IndexedDB.
 */
import type { PlaybackCandidate } from '../../playbackResolver/types.ts'
import type { Track } from '../../../types/track.ts'

export type PreparedTrackEntry = {
  track: Track
  url: string
  candidate: PlaybackCandidate | null
  playRequestId: number
  createdAt: number
}

export class PreparedTrackCache {
  private readonly entries = new Map<string, PreparedTrackEntry>()

  set(preparedRef: string, entry: PreparedTrackEntry): void {
    this.entries.set(preparedRef, entry)
  }

  get(preparedRef: string): PreparedTrackEntry | undefined {
    return this.entries.get(preparedRef)
  }

  take(preparedRef: string): PreparedTrackEntry | undefined {
    const entry = this.entries.get(preparedRef)
    if (entry) {
      this.entries.delete(preparedRef)
    }
    return entry
  }

  delete(preparedRef: string): void {
    this.entries.delete(preparedRef)
  }

  /** Удалить записи устаревших playRequestId (после нового Play). */
  dropOlderThan(playRequestId: number): void {
    for (const [ref, entry] of this.entries) {
      if (entry.playRequestId < playRequestId) {
        this.entries.delete(ref)
      }
    }
  }

  clear(): void {
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }
}

export function createPreparedRef(
  playRequestId: number,
  trackId: string,
): string {
  return `session-prep:${playRequestId}:${trackId}`
}
