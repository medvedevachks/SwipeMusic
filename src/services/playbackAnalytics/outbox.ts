import type { PlaybackEvent } from './types.ts'
import { PLAYBACK_EVENT } from './types.ts'

export type OutboxItem = {
  userId: string | null
  event: PlaybackEvent
}

const MAX_ITEMS = 200

export class PlaybackOutbox {
  private items: OutboxItem[] = []

  append(userId: string | null, events: readonly PlaybackEvent[]): void {
    for (const event of events) {
      const exists = this.items.some(
        (item) => item.userId === userId && item.event.eventId === event.eventId,
      )
      if (exists) {
        continue
      }
      this.items.push({ userId, event })
    }
    this.trim()
  }

  peek(userId: string, limit: number): PlaybackEvent[] {
    return this.items
      .filter((item) => item.userId === userId)
      .slice(0, limit)
      .map((item) => item.event)
  }

  ack(userId: string, eventIds: readonly string[]): void {
    const ids = new Set(eventIds)
    this.items = this.items.filter((item) => item.userId !== userId || !ids.has(item.event.eventId))
  }

  holdCount(userId: string | null): number {
    return this.items.filter((item) => item.userId === userId).length
  }

  private trim(): void {
    while (this.items.length > MAX_ITEMS) {
      const progress = this.items.findIndex((item) => item.event.eventType === PLAYBACK_EVENT.PROGRESS)
      if (progress >= 0) {
        this.items.splice(progress, 1)
        continue
      }
      this.items.shift()
    }
  }
}
