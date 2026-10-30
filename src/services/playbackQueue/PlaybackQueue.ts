import type { Track } from '../../types/track.ts'
import {
  NONE_PLAYBACK_CONTEXT,
  parsePlaybackContext,
  type PlaybackContext,
} from '../../types/playbackContext.ts'
import {
  noteContextChange,
  noteSearchFlowEvent,
} from '../continuation/searchFlowDiag.ts'

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
  /** История фактически запущенных track id (единая для плеера и карточек). */
  history: string[]
  /**
   * Курсор в history: Previous/Next ходят по нему, не уничтожая «вперёд».
   * -1 = пусто. Persist для reload.
   */
  historyIndex: number
  /** Provenance очереди (album / swipe / …). */
  context: PlaybackContext
}

export type PlaybackQueueListener = (snapshot: PlaybackQueueSnapshot) => void

/** localStorage key очереди. Экспорт для тестов persist/restore. */
export const PLAYBACK_QUEUE_STORAGE_KEY = 'swipe-music-playback-queue-v1'

/** Снимок на диске: snapshot + явный provenance insertNext. */
export type PersistedPlaybackQueue = PlaybackQueueSnapshot & {
  /**
   * Id треков, добавленных через insertNext.
   * Отсутствие поля = legacy payload без достоверного provenance.
   */
  sessionTailIds?: string[]
  /**
   * Разобранные, но ещё звучавшие на момент persist.
   * После restore вычищаются из items (нет mid-play якоря).
   */
  pendingRemovalIds?: string[]
}

function stripPreview(track: Track): Track {
  return { ...track, previewUrl: null }
}

/** Сколько таких же id стоит строго левее index (0 = первое вхождение). */
function occurrenceRank(items: readonly Track[], index: number): number {
  if (index < 0 || index >= items.length) {
    return 0
  }
  const id = items[index]?.id
  if (!id) {
    return 0
  }
  let rank = 0
  for (let i = 0; i < index; i += 1) {
    if (items[i]?.id === id) {
      rank += 1
    }
  }
  return rank
}

/** Индекс k-го вхождения id; -1 если такого нет. */
function indexOfOccurrence(
  items: readonly Track[],
  id: string,
  rank: number,
): number {
  let seen = 0
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]?.id !== id) {
      continue
    }
    if (seen === rank) {
      return i
    }
    seen += 1
  }
  // Меньше вхождений, чем раньше — якорь на последнее оставшееся.
  if (seen > 0 && rank >= seen) {
    let last = -1
    for (let i = 0; i < items.length; i += 1) {
      if (items[i]?.id === id) {
        last = i
      }
    }
    return last
  }
  return -1
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
  /** Курсор в history; не pop при Previous — иначе Next зовёт engine вместо replay. */
  private historyIndex = -1
  private context: PlaybackContext = NONE_PLAYBACK_CONTEXT
  /**
   * Id треков, поставленных через insertNext в текущей сессии очереди.
   * Отличает continuation / «играть следующим» от чужого search-hit в хвосте.
   */
  private sessionTailIds = new Set<string>()
  /**
   * Убраны из будущих циклов / Previous, но current ещё играет до Next или ended.
   * Не персистим: после reload безопаснее не восстанавливать «призраков».
   */
  private pendingRemovalIds = new Set<string>()
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
      historyIndex: this.historyIndex,
      context: this.context,
    }
  }

  getPlaybackContext(): PlaybackContext {
    return this.context
  }

  setPlaybackContext(context: PlaybackContext): void {
    noteContextChange({
      source: 'PlaybackQueue.setPlaybackContext',
      before: this.context.type,
      after: context.type,
      queueLength: this.items.length,
      currentIndex: this.currentIndex,
      trackId: this.items[this.currentIndex]?.id ?? null,
    })
    this.context = context
    this.emit()
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

  /**
   * @param context — если передан, обновляет Playback Context.
   *   Если не передан — сохраняет текущий context (навигация/внутренние вызовы).
   */
  setQueue(
    tracks: Track[],
    startIndex = 0,
    context?: PlaybackContext,
  ): void {
    const contextBefore = this.context.type
    const lengthBefore = this.items.length
    const cleaned = tracks
      .filter((track) => Boolean(track.sourceId) || Boolean(track.id))
      .map(stripPreview)

    if (context !== undefined) {
      this.context = context
    }

    this.items = cleaned
    this.sessionTailIds.clear()
    this.pendingRemovalIds.clear()
    if (cleaned.length === 0) {
      this.currentIndex = -1
      this.playOrder = []
      this.playOrderIndex = -1
      this.history = []
      this.historyIndex = -1
      noteSearchFlowEvent({
        source: 'PlaybackQueue.setQueue',
        contextBefore,
        contextAfter: this.context.type,
        queueLengthBefore: lengthBefore,
        queueLengthAfter: 0,
        currentIndex: -1,
        detail: 'empty',
      })
      this.emit()
      return
    }

    const index = Math.min(Math.max(0, startIndex), cleaned.length - 1)
    this.currentIndex = index
    this.rebuildPlayOrder(index)
    this.history = []
    this.historyIndex = -1
    this.pushHistory(cleaned[index]!.id)
    noteSearchFlowEvent({
      source: 'PlaybackQueue.setQueue',
      contextBefore,
      contextAfter: this.context.type,
      queueLengthBefore: lengthBefore,
      queueLengthAfter: cleaned.length,
      currentIndex: index,
      trackId: cleaned[index]?.id ?? null,
      nextSource: 'queue',
      detail: `tracks=${cleaned.length}`,
    })
    this.emit()
  }

  /**
   * Дополняет/заменяет items уже запущенного playlist-контекста без setQueue().
   * Сохраняет текущий трек как временный якорь даже если его нет в `tracks`
   * (разобран из sys_swipes во время background prepare).
   * Возвращает false только при чужом context или отсутствии current.
   */
  replacePlaylistItemsPreservingPlayback(
    tracks: Track[],
    expected: { type: 'playlist'; id: string },
  ): boolean {
    if (
      this.context.type !== 'playlist' ||
      this.context.id !== expected.id
    ) {
      return false
    }

    const cleaned = tracks
      .filter((track) => Boolean(track.sourceId) || Boolean(track.id))
      .map(stripPreview)

    const playing =
      this.currentIndex >= 0 && this.currentIndex < this.items.length
        ? this.items[this.currentIndex]
        : null
    const playingId = playing?.id ?? null
    if (!playingId || !playing) {
      return false
    }

    // Не возвращать pending в хвост; current — только якорь.
    let nextTracks = cleaned.filter(
      (track) => !this.pendingRemovalIds.has(track.id),
    )
    const playingInIncoming = cleaned.some((track) => track.id === playingId)
    if (!nextTracks.some((track) => track.id === playingId)) {
      nextTracks = [playing, ...nextTracks]
      // Разобран / отфильтрован live membership — не для будущих циклов.
      if (!playingInIncoming) {
        this.pendingRemovalIds.add(playingId)
      }
    }

    if (nextTracks.length === 0) {
      return false
    }

    // При дубликатах id якорим на то же вхождение (rank), не на findIndex → [0].
    const playingRank = occurrenceRank(this.items, this.currentIndex)
    const nextIndex = indexOfOccurrence(nextTracks, playingId, playingRank)
    if (nextIndex < 0) {
      return false
    }

    const knownIds = new Set(nextTracks.map((track) => track.id))
    this.sessionTailIds = new Set(
      [...this.sessionTailIds].filter((id) => knownIds.has(id)),
    )
    this.pendingRemovalIds = new Set(
      [...this.pendingRemovalIds].filter((id) => knownIds.has(id)),
    )
    // Shuffle ON: не вызывать rebuildPlayOrder — иначе Next переиграется.
    this.rebindPlayOrderAfterItemReplace(nextTracks, nextIndex)
    // history / historyIndex / repeat / shuffle / context не сбрасываем.
    this.emit()
    return true
  }

  /**
   * После replace items: перепривязать playOrder к новым индексам.
   * Shuffle OFF — identity как раньше.
   * Shuffle ON — сохранить уже запланированный порядок (вкл. Next) по
   * вхождениям (id + occurrence rank); новые индексы — после хвоста.
   * Инвариант: playOrder — перестановка 0..n-1 без дыр и дублей индексов.
   */
  private rebindPlayOrderAfterItemReplace(
    nextTracks: Track[],
    nextIndex: number,
  ): void {
    if (
      nextIndex < 0 ||
      nextIndex >= nextTracks.length ||
      nextTracks.length === 0
    ) {
      this.items = nextTracks
      this.rebuildPlayOrder(0)
      return
    }

    if (this.shuffleMode !== 'ON') {
      this.items = nextTracks
      this.rebuildPlayOrder(nextIndex)
      return
    }

    const used = new Set<number>()
    const preserved: number[] = []
    for (const oldIndex of this.playOrder) {
      const id = this.items[oldIndex]?.id
      if (!id) {
        continue
      }
      const rank = occurrenceRank(this.items, oldIndex)
      const mapped = indexOfOccurrence(nextTracks, id, rank)
      if (mapped < 0 || used.has(mapped)) {
        continue
      }
      used.add(mapped)
      preserved.push(mapped)
    }

    if (!used.has(nextIndex)) {
      preserved.unshift(nextIndex)
      used.add(nextIndex)
    }

    const appended: number[] = []
    for (let index = 0; index < nextTracks.length; index += 1) {
      if (used.has(index)) {
        continue
      }
      used.add(index)
      appended.push(index)
    }

    this.items = nextTracks
    this.playOrder = [...preserved, ...appended]
    this.currentIndex = nextIndex
    const orderPos = this.playOrder.indexOf(nextIndex)
    this.playOrderIndex = orderPos >= 0 ? orderPos : 0
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

  /**
   * Убирает непрослушанный хвост, не защищённый insertNext (обычно dumps выдачи).
   * Continuation / «играть следующим» помечены sessionTailIds и сохраняются
   * даже если впереди ровно один трек. Чужой одиночный search-hit срезается.
   * Не трогает history, repeatMode, shuffleMode; playOrder с pinned current.
   */
  trimUnplayedTail(): void {
    if (this.currentIndex < 0 || this.items.length === 0) {
      return
    }
    if (this.currentIndex >= this.items.length - 1) {
      return
    }
    const pinnedId = this.items[this.currentIndex]?.id ?? null
    const head = this.items.slice(0, this.currentIndex + 1)
    const keptTail = this.items
      .slice(this.currentIndex + 1)
      .filter((track) => this.sessionTailIds.has(track.id))
    if (keptTail.length === this.items.length - this.currentIndex - 1) {
      return
    }
    this.items = [...head, ...keptTail]
    this.rebuildPlayOrder(this.currentIndex)
    if (pinnedId && this.items[this.currentIndex]?.id !== pinnedId) {
      const restored = this.items.findIndex((track) => track.id === pinnedId)
      if (restored >= 0) {
        this.rebuildPlayOrder(restored)
      }
    }
    this.emit()
  }

  insertNext(track: Track): void {
    // previewUrl сохраняем: после Next PlaybackResolver читает трек из очереди.
    const cleaned: Track = { ...track }
    if (this.items.length === 0 || this.currentIndex < 0) {
      this.setQueue([cleaned], 0)
      return
    }

    const insertAt = this.currentIndex + 1
    this.items.splice(insertAt, 0, cleaned)
    this.sessionTailIds.add(cleaned.id)

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
    this.pendingRemovalIds.delete(trackId)
    this.hardRemoveTrack(trackId, { advanceIfCurrent: true })
  }

  /**
   * Убрать трек из будущих циклов и Previous, не останавливая текущее аудио.
   * Current остаётся до Next / ended; затем вычищается.
   * Чужой контекст вызывающий код не должен трогать — проверка ownership снаружи.
   */
  removePreservingCurrentPlayback(trackId: string): void {
    this.stripTrackFromHistory(trackId)
    this.sessionTailIds.delete(trackId)

    const removeIndex = this.items.findIndex((track) => track.id === trackId)
    if (removeIndex < 0) {
      this.pendingRemovalIds.delete(trackId)
      return
    }

    if (removeIndex !== this.currentIndex) {
      this.pendingRemovalIds.delete(trackId)
      this.hardRemoveTrack(trackId, { advanceIfCurrent: false })
      return
    }

    this.pendingRemovalIds.add(trackId)
    this.emit()
  }

  /** Id, отложенно снятые с очереди, но ещё звучащие. Для тестов / UI. */
  getPendingRemovalIds(): readonly string[] {
    return [...this.pendingRemovalIds]
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
    this.historyIndex = -1
    this.sessionTailIds.clear()
    this.pendingRemovalIds.clear()
    this.context = NONE_PLAYBACK_CONTEXT
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

    const leavingId =
      this.currentIndex >= 0 ? (this.items[this.currentIndex]?.id ?? null) : null
    const leavingWasPending =
      leavingId !== null && this.pendingRemovalIds.has(leavingId)

    if (options?.fromEnded && this.repeatMode === 'ONE') {
      if (!leavingWasPending) {
        return this.current()
      }
      // Sorted current: не повторять A — перейти к B как при обычном next.
    }

    const upcoming = this.peekNextIndex(options?.fromEnded === true)
    if (upcoming == null) {
      if (this.repeatMode === 'ALL') {
        const restart = this.peekFirstEligiblePlayOrderIndex()
        if (restart == null) {
          if (leavingWasPending && leavingId) {
            this.purgePendingTrack(leavingId)
          }
          this.emit()
          return null
        }
        this.playOrderIndex = restart.playOrderIndex
        this.currentIndex = restart.itemIndex
        if (leavingWasPending && leavingId) {
          this.purgePendingTrack(leavingId)
        }
        const track = this.current()
        if (track) {
          this.pushHistory(track.id)
        }
        this.emit()
        return track
      }
      if (leavingWasPending && leavingId) {
        this.purgePendingTrack(leavingId)
        this.emit()
      }
      return null
    }

    this.playOrderIndex = upcoming.playOrderIndex
    this.currentIndex = upcoming.itemIndex
    if (leavingWasPending && leavingId) {
      this.purgePendingTrack(leavingId)
    }
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

    if (this.historyIndex > 0) {
      this.historyIndex -= 1
      const prevId = this.history[this.historyIndex]
      const prevIndex = this.items.findIndex((track) => track.id === prevId)
      if (prevIndex >= 0) {
        this.currentIndex = prevIndex
        this.playOrderIndex = Math.max(0, this.playOrder.indexOf(prevIndex))
        this.emit()
        return this.items[prevIndex] ?? null
      }
      // Id пропал из items — откат курсора и fallback.
      this.historyIndex += 1
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
      if (this.repeatMode === 'ALL') {
        const restart = this.peekFirstEligiblePlayOrderIndex()
        return restart ? (this.items[restart.itemIndex] ?? null) : null
      }
      return null
    }
    return this.items[upcoming.itemIndex] ?? null
  }

  peekPrevious(): Track | null {
    if (this.historyIndex > 0) {
      const prevId = this.history[this.historyIndex - 1]
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
    for (let pos = this.playOrderIndex + 1; pos < this.playOrder.length; pos += 1) {
      const itemIndex = this.playOrder[pos]!
      const id = this.items[itemIndex]?.id
      if (id && this.pendingRemovalIds.has(id)) {
        continue
      }
      return { playOrderIndex: pos, itemIndex }
    }
    return null
  }

  private peekFirstEligiblePlayOrderIndex(): {
    playOrderIndex: number
    itemIndex: number
  } | null {
    for (let pos = 0; pos < this.playOrder.length; pos += 1) {
      const itemIndex = this.playOrder[pos]!
      const id = this.items[itemIndex]?.id
      if (!id || this.pendingRemovalIds.has(id)) {
        continue
      }
      return { playOrderIndex: pos, itemIndex }
    }
    return null
  }

  private stripTrackFromHistory(trackId: string): void {
    const removedHistoryAt = this.history.lastIndexOf(trackId)
    this.history = this.history.filter((id) => id !== trackId)
    if (removedHistoryAt >= 0 && this.historyIndex >= removedHistoryAt) {
      this.historyIndex = Math.max(-1, this.historyIndex - 1)
    }
    if (this.historyIndex >= this.history.length) {
      this.historyIndex = this.history.length - 1
    }
  }

  /**
   * Жёсткое удаление из items. advanceIfCurrent — поведение классического remove().
   */
  private hardRemoveTrack(
    trackId: string,
    options: { advanceIfCurrent: boolean },
  ): void {
    const removeIndex = this.items.findIndex((track) => track.id === trackId)
    if (removeIndex < 0) {
      return
    }

    const wasCurrent = removeIndex === this.currentIndex
    this.items.splice(removeIndex, 1)
    this.stripTrackFromHistory(trackId)
    this.sessionTailIds.delete(trackId)
    this.pendingRemovalIds.delete(trackId)

    if (this.items.length === 0) {
      this.clear()
      return
    }

    if (wasCurrent && options.advanceIfCurrent) {
      const nextIndex = Math.min(removeIndex, this.items.length - 1)
      this.currentIndex = nextIndex
      this.rebuildPlayOrder(nextIndex)
    } else {
      if (removeIndex < this.currentIndex) {
        this.currentIndex -= 1
      } else if (wasCurrent) {
        // Current уже сдвинут next(); индекс мог указывать на тот же слот.
        this.currentIndex = Math.min(this.currentIndex, this.items.length - 1)
      }
      this.rebuildPlayOrder(this.currentIndex)
    }
    this.emit()
  }

  /** После ухода с pending current — вырезать id, сохранив новый currentIndex. */
  private purgePendingTrack(trackId: string): void {
    this.pendingRemovalIds.delete(trackId)
    const removeIndex = this.items.findIndex((track) => track.id === trackId)
    if (removeIndex < 0) {
      return
    }
    const pinnedId =
      this.currentIndex >= 0 ? (this.items[this.currentIndex]?.id ?? null) : null
    this.items.splice(removeIndex, 1)
    this.sessionTailIds.delete(trackId)
    if (this.items.length === 0) {
      this.currentIndex = -1
      this.playOrder = []
      this.playOrderIndex = -1
      return
    }
    if (pinnedId && pinnedId !== trackId) {
      const restored = this.items.findIndex((track) => track.id === pinnedId)
      this.rebuildPlayOrder(restored >= 0 ? restored : 0)
    } else {
      this.rebuildPlayOrder(Math.min(removeIndex, this.items.length - 1))
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
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === trackId) {
      return
    }
    // Replay уже известного следующего слота истории (после Previous).
    if (
      this.historyIndex >= 0 &&
      this.historyIndex < this.history.length - 1 &&
      this.history[this.historyIndex + 1] === trackId
    ) {
      this.historyIndex += 1
      return
    }
    // Новая ветка: обрезаем «вперёд» от курсора, затем append.
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1)
    }
    this.history.push(trackId)
    this.historyIndex = this.history.length - 1
    if (this.history.length > 200) {
      const overflow = this.history.length - 200
      this.history = this.history.slice(-200)
      this.historyIndex = Math.max(0, this.historyIndex - overflow)
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
      const payload: PersistedPlaybackQueue = {
        ...this.getSnapshot(),
        items: this.items.map(stripPreview),
        sessionTailIds: [...this.sessionTailIds],
        pendingRemovalIds: [...this.pendingRemovalIds],
      }
      localStorage.setItem(PLAYBACK_QUEUE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // quota / private mode
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(PLAYBACK_QUEUE_STORAGE_KEY)
      if (!raw) {
        return
      }
      const data = JSON.parse(raw) as PersistedPlaybackQueue & {
        context?: unknown
      }
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
      const rawHistoryIndex =
        typeof data.historyIndex === 'number' ? data.historyIndex : -1
      if (this.history.length === 0) {
        this.historyIndex = -1
      } else if (rawHistoryIndex >= 0 && rawHistoryIndex < this.history.length) {
        this.historyIndex = rawHistoryIndex
      } else {
        // Legacy persist без historyIndex: курсор = конец истории.
        this.historyIndex = this.history.length - 1
      }
      this.context = parsePlaybackContext(data.context)
      this.sessionTailIds.clear()
      this.pendingRemovalIds.clear()
      this.applyRestoredSessionTail(data)
      this.purgeRestoredPendingRemovals(data)

      if (this.items.length > 0 && this.currentIndex < 0) {
        this.currentIndex = 0
        this.rebuildPlayOrder(0)
      }
    } catch {
      // ignore corrupt storage
    }
  }

  /**
   * После reload mid-play якоря нет: разобранные треки не должны
   * возвращаться в очередь (призраки sys_swipes).
   */
  private purgeRestoredPendingRemovals(data: PersistedPlaybackQueue): void {
    const raw = Array.isArray(data.pendingRemovalIds)
      ? data.pendingRemovalIds
      : []
    const pending = new Set(
      raw.filter((id): id is string => typeof id === 'string' && Boolean(id)),
    )
    if (pending.size === 0) {
      return
    }
    const pinnedId =
      this.currentIndex >= 0 ? (this.items[this.currentIndex]?.id ?? null) : null
    this.items = this.items.filter((track) => !pending.has(track.id))
    for (const id of pending) {
      this.stripTrackFromHistory(id)
      this.sessionTailIds.delete(id)
    }
    this.pendingRemovalIds.clear()
    if (this.items.length === 0) {
      this.currentIndex = -1
      this.playOrder = []
      this.playOrderIndex = -1
      return
    }
    if (pinnedId && !pending.has(pinnedId)) {
      const restored = this.items.findIndex((track) => track.id === pinnedId)
      this.rebuildPlayOrder(restored >= 0 ? restored : 0)
      return
    }
    this.rebuildPlayOrder(0)
  }

  /**
   * Восстанавливает sessionTailIds из persist.
   * Legacy search-seed без поля: не доверять хвосту (срез до current), history не трогаем.
   * Album / playlist / swipe / radio: полный список items сохраняется.
   */
  private applyRestoredSessionTail(data: PersistedPlaybackQueue): void {
    const hasProvenance = Object.prototype.hasOwnProperty.call(data, 'sessionTailIds')
    if (hasProvenance) {
      const known = new Set(this.items.map((track) => track.id))
      const rawTail = Array.isArray(data.sessionTailIds) ? data.sessionTailIds : []
      for (const id of rawTail) {
        if (typeof id === 'string' && known.has(id)) {
          this.sessionTailIds.add(id)
        }
      }
      return
    }

    if (this.context.type !== 'search-seed') {
      return
    }
    // Старый search-seed dump в localStorage: hits ≠ continuation.
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length - 1) {
      this.items = this.items.slice(0, this.currentIndex + 1)
      this.rebuildPlayOrder(this.currentIndex)
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
