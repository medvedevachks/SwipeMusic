import type { Track } from '../../types/track'

export type RepeatMode = 'OFF' | 'ONE' | 'ALL'
export type ShuffleMode = 'OFF' | 'ON'

export type PlaybackQueueSnapshot = {
  items: Track[]
  /** Индекс в исходном items[]. */
  currentIndex: number
  /** Порядок воспроизведения — индексы в items[]. Не меняет items. */
  playOrder: number[]
  /** Позиция в playOrder. */
  playOrderIndex: number
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  /** История track id для Previous после shuffle. */
  history: string[]
}

export type PlaybackQueueListener = (snapshot: PlaybackQueueSnapshot) => void

const STORAGE_KEY = 'swipe-music-playback-queue-v1'

function stripPreview(track: Track): Track {
  return { ...track, previewUrl: null }
}

function buildIdentityOrder(length: number): number[] {
  return Array.from({ length }, (_, index) => index)
}

function shuffleOrder(length: number, pinnedIndex: number): number[] {
  const order = buildIdentityOrder(length)
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const pinnedAt = order.indexOf(pinnedIndex)
  if (pinnedAt > 0) {
    order.splice(pinnedAt, 1)
    order.unshift(pinnedIndex)
  }
  return order
}

/**
 * Единственный источник порядка воспроизведения.
 * Не знает Provider / React / HTMLAudioElement.
 */
export class PlaybackQueue {
  private items: Track[] = []
  private currentIndex = -1
  private playOrder: number[] = []
  private playOrderIndex = -1
  private repeatMode: RepeatMode = 'OFF'
  private shuffleMode: ShuffleMode = 'OFF'
  private history: string[] = []
  private readonly listeners = new Set<PlaybackQueueListener>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.restore()
  }

  subscribe(listener: PlaybackQueueListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): PlaybackQueueSnapshot {
    return {
      items: [...this.items],
      currentIndex: this.currentIndex,
      playOrder: [...this.playOrder],
      playOrderIndex: this.playOrderIndex,
      repeatMode: this.repeatMode,
      shuffleMode: this.shuffleMode,
      history: [...this.history],
    }
  }

  /** Исходный порядок очереди (без shuffle). */
  getItems(): Track[] {
    return [...this.items]
  }

  /** Порядок воспроизведения. */
  getPlayableTracks(): Track[] {
    if (this.shuffleMode === 'ON' && this.playOrder.length > 0) {
      return this.playOrder
        .map((index) => this.items[index])
        .filter((track): track is Track => Boolean(track))
    }
    return [...this.items]
  }

  setQueue(tracks: Track[], startIndex = 0): void {
    const cleaned = tracks
      .filter((track) => Boolean(track.sourceId) || Boolean(track.id))
      .map(stripPreview)

    this.items = cleaned
    if (cleaned.length === 0) {
      this.currentIndex = -1
      this.playOrder = []
      this.playOrderIndex = -1
      this.history = []
      this.emit()
      return
    }

    const index = Math.min(Math.max(0, startIndex), cleaned.length - 1)
    this.currentIndex = index
    this.rebuildPlayOrder(index)
    this.history = []
    this.pushHistory(cleaned[index]!.id)
    this.emit()
  }

  append(tracks: Track[]): void {
    if (tracks.length === 0) {
      return
    }
    const cleaned = tracks.map(stripPreview)
    const wasEmpty = this.items.length === 0
    this.items.push(...cleaned)
    if (wasEmpty) {
      this.currentIndex = 0
      this.rebuildPlayOrder(0)
      this.pushHistory(this.items[0]!.id)
    } else if (this.shuffleMode === 'ON') {
      const base = this.currentIndex >= 0 ? this.currentIndex : 0
      this.rebuildPlayOrder(base)
    } else {
      this.playOrder = buildIdentityOrder(this.items.length)
    }
    this.emit()
  }

  insertNext(track: Track): void {
    const cleaned = stripPreview(track)
    if (this.items.length === 0 || this.currentIndex < 0) {
      this.setQueue([cleaned], 0)
      return
    }

    const insertAt = this.currentIndex + 1
    this.items.splice(insertAt, 0, cleaned)

    if (this.shuffleMode === 'ON') {
      const nextPos = this.playOrderIndex + 1
      const newOrder: number[] = []
      for (const idx of this.playOrder) {
        newOrder.push(idx >= insertAt ? idx + 1 : idx)
      }
      newOrder.splice(Math.min(nextPos, newOrder.length), 0, insertAt)
      this.playOrder = newOrder
    } else {
      this.playOrder = buildIdentityOrder(this.items.length)
      this.playOrderIndex = this.currentIndex
    }
    this.emit()
  }

  remove(trackId: string): void {
    const removeIndex = this.items.findIndex((track) => track.id === trackId)
    if (removeIndex < 0) {
      return
    }

    const wasCurrent = removeIndex === this.currentIndex
    this.items.splice(removeIndex, 1)
    this.history = this.history.filter((id) => id !== trackId)

    if (this.items.length === 0) {
      this.clear()
      return
    }

    if (wasCurrent) {
      const nextIndex = Math.min(removeIndex, this.items.length - 1)
      this.currentIndex = nextIndex
      this.rebuildPlayOrder(nextIndex)
    } else {
      if (removeIndex < this.currentIndex) {
        this.currentIndex -= 1
      }
      this.rebuildPlayOrder(this.currentIndex)
    }
    this.emit()
  }

  move(from: number, to: number): void {
    if (
      from < 0 ||
      to < 0 ||
      from >= this.items.length ||
      to >= this.items.length ||
      from === to
    ) {
      return
    }

    const [item] = this.items.splice(from, 1)
    this.items.splice(to, 0, item!)

    if (this.currentIndex === from) {
      this.currentIndex = to
    } else if (from < this.currentIndex && to >= this.currentIndex) {
      this.currentIndex -= 1
    } else if (from > this.currentIndex && to <= this.currentIndex) {
      this.currentIndex += 1
    }

    this.rebuildPlayOrder(this.currentIndex)
    this.emit()
  }

  clear(): void {
    this.items = []
    this.currentIndex = -1
    this.playOrder = []
    this.playOrderIndex = -1
    this.history = []
    this.emit()
  }

  current(): Track | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.items.length) {
      return null
    }
    return this.items[this.currentIndex] ?? null
  }

  /**
   * Следующий трек с учётом Repeat/Shuffle.
   * @param fromEnded — вызов после ended (для Repeat ONE)
   */
  next(options?: { fromEnded?: boolean }): Track | null {
    if (this.items.length === 0) {
      return null
    }

    if (options?.fromEnded && this.repeatMode === 'ONE') {
      return this.current()
    }

    const upcoming = this.peekNextIndex(options?.fromEnded === true)
    if (upcoming == null) {
      if (this.repeatMode === 'ALL') {
        this.playOrderIndex = 0
        this.currentIndex = this.playOrder[0] ?? 0
        const track = this.current()
        if (track) {
          this.pushHistory(track.id)
        }
        this.emit()
        return track
      }
      return null
    }

    this.playOrderIndex = upcoming.playOrderIndex
    this.currentIndex = upcoming.itemIndex
    const track = this.current()
    if (track) {
      this.pushHistory(track.id)
    }
    this.emit()
    return track
  }

  previous(): Track | null {
    if (this.items.length === 0) {
      return null
    }

    if (this.history.length >= 2) {
      this.history.pop()
      const prevId = this.history[this.history.length - 1]
      const prevIndex = this.items.findIndex((track) => track.id === prevId)
      if (prevIndex >= 0) {
        this.currentIndex = prevIndex
        this.playOrderIndex = Math.max(0, this.playOrder.indexOf(prevIndex))
        this.emit()
        return this.items[prevIndex] ?? null
      }
    }

    const prev = this.peekPreviousIndex()
    if (prev == null) {
      return this.current()
    }

    this.playOrderIndex = prev.playOrderIndex
    this.currentIndex = prev.itemIndex
    const track = this.current()
    if (track) {
      this.pushHistory(track.id)
    }
    this.emit()
    return track
  }

  peekNext(): Track | null {
    const upcoming = this.peekNextIndex(false)
    if (upcoming == null) {
      if (this.repeatMode === 'ALL' && this.playOrder.length > 0) {
        return this.items[this.playOrder[0]!] ?? null
      }
      return null
    }
    return this.items[upcoming.itemIndex] ?? null
  }

  peekPrevious(): Track | null {
    if (this.history.length >= 2) {
      const prevId = this.history[this.history.length - 2]
      return this.items.find((track) => track.id === prevId) ?? null
    }
    const prev = this.peekPreviousIndex()
    if (prev == null) {
      return null
    }
    return this.items[prev.itemIndex] ?? null
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode = mode
    this.emit()
  }

  setShuffleMode(mode: ShuffleMode): void {
    this.shuffleMode = mode
    const pinned = this.currentIndex >= 0 ? this.currentIndex : 0
    this.rebuildPlayOrder(pinned)
    this.emit()
  }

  getRepeatMode(): RepeatMode {
    return this.repeatMode
  }

  getShuffleMode(): ShuffleMode {
    return this.shuffleMode
  }

  /** Синхронизировать currentIndex с треком (после playTrack). */
  focusTrack(trackId: string): void {
    const index = this.items.findIndex((track) => track.id === trackId)
    if (index < 0) {
      return
    }
    this.currentIndex = index
    const orderPos = this.playOrder.indexOf(index)
    this.playOrderIndex = orderPos >= 0 ? orderPos : 0
    this.pushHistory(trackId)
    this.emit()
  }

  private peekNextIndex(
    fromEnded: boolean,
  ): { playOrderIndex: number; itemIndex: number } | null {
    void fromEnded
    if (this.playOrder.length === 0) {
      return null
    }
    const nextPos = this.playOrderIndex + 1
    if (nextPos >= this.playOrder.length) {
      return null
    }
    return {
      playOrderIndex: nextPos,
      itemIndex: this.playOrder[nextPos]!,
    }
  }

  private peekPreviousIndex(): {
    playOrderIndex: number
    itemIndex: number
  } | null {
    if (this.playOrder.length === 0) {
      return null
    }
    const prevPos = this.playOrderIndex - 1
    if (prevPos < 0) {
      return null
    }
    return {
      playOrderIndex: prevPos,
      itemIndex: this.playOrder[prevPos]!,
    }
  }

  private rebuildPlayOrder(pinnedItemIndex: number): void {
    if (this.items.length === 0) {
      this.playOrder = []
      this.playOrderIndex = -1
      return
    }
    const pinned = Math.min(
      Math.max(0, pinnedItemIndex),
      this.items.length - 1,
    )
    this.playOrder =
      this.shuffleMode === 'ON'
        ? shuffleOrder(this.items.length, pinned)
        : buildIdentityOrder(this.items.length)
    this.playOrderIndex = Math.max(0, this.playOrder.indexOf(pinned))
    this.currentIndex = pinned
  }

  private pushHistory(trackId: string): void {
    if (this.history[this.history.length - 1] === trackId) {
      return
    }
    this.history.push(trackId)
    if (this.history.length > 200) {
      this.history = this.history.slice(-200)
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persist()
    }, 200)
  }

  private persist(): void {
    try {
      const payload: PlaybackQueueSnapshot = {
        ...this.getSnapshot(),
        items: this.items.map(stripPreview),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // quota / private mode
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }
      const data = JSON.parse(raw) as PlaybackQueueSnapshot
      if (!Array.isArray(data.items)) {
        return
      }
      this.items = data.items.map(stripPreview)
      this.currentIndex = data.currentIndex ?? -1
      this.playOrder = Array.isArray(data.playOrder)
        ? data.playOrder
        : buildIdentityOrder(this.items.length)
      this.playOrderIndex = data.playOrderIndex ?? -1
      this.repeatMode = data.repeatMode ?? 'OFF'
      this.shuffleMode = data.shuffleMode ?? 'OFF'
      this.history = Array.isArray(data.history) ? data.history : []

      if (this.items.length > 0 && this.currentIndex < 0) {
        this.currentIndex = 0
        this.rebuildPlayOrder(0)
      }
    } catch {
      // ignore corrupt storage
    }
  }
}

let singleton: PlaybackQueue | null = null

export function getPlaybackQueue(): PlaybackQueue {
  if (!singleton) {
    singleton = new PlaybackQueue()
  }
  return singleton
}
