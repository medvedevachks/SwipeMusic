import {
  computeProgress,
  type PlayerState,
} from '../../types/player'
import { initialPlayerState } from '../../types/player'
import type { PlaybackContext } from '../../types/playbackContext'
import type { Track } from '../../types/track'
import { getPlaybackResolver } from '../playbackResolver'
import type { PlaybackCandidate } from '../playbackResolver'
import { getContinuationSession } from '../continuation/ContinuationSession.ts'
import { noteSearchFlowEvent } from '../continuation/searchFlowDiag.ts'
import {
  isRecommendationAdvanceContext,
  prepareRecommendationFollowUp,
  resolveRecommendationAdvance,
} from '../recommendation/advance.ts'
import {
  clearRecommendationExhausted,
  isRecommendationExhausted,
  markRecommendationExhausted,
} from '../recommendation/sessionState.ts'
import {
  getRecommendationAdvanceEpoch,
  invalidateRecommendationAdvance,
} from '../recommendation/advanceEpoch.ts'
import { enqueueRecommendationAdvance } from '../recommendation/sessionRuntime.ts'
import { reportPlayback } from '../playbackAnalytics/report.ts'
import { getPlaybackQueue } from '../playbackQueue'
import {
  beginQueueTransport,
  cancelActiveFallback,
  emitPlaybackMediaError,
} from '../runtimeFallback/fallbackControl.ts'
import { routeLivePlayback } from '../runtimeFallback/livePlayback.ts'
import { attachMediaSession } from './mediaSession.ts'
import type { PlayerAdapter } from './PlayerAdapter'
import { getPlayerManager } from './PlayerManager'
import { settlePlayGeneration } from './stalePlaySettlement.ts'

type StateListener = (state: PlayerState) => void

/** Браузерный autoplay-block — не показываем пользователю как ошибку UI. */
function isAutoplayBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const name = error.name
  const message = error.message.toLowerCase()

  return (
    name === 'NotAllowedError' ||
    message.includes("user didn't interact") ||
    message.includes('play() failed because the user') ||
    message.includes('notallowederror')
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Resolver miss / network — await playTrack должен отклоняться. */
class PlaybackResolveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaybackResolveError'
  }
}

/**
 * Воспроизведение текущего трека.
 * Порядок — только PlaybackQueue; AudioPlayer не владеет очередью.
 *
 * currentTrack = фактически активный playback.
 * pendingTrack = запрошенный пользователем switch (пока resolve/load).
 */
export class AudioPlayer {
  private readonly adapter: PlayerAdapter
  private readonly listeners = new Set<StateListener>()
  private unsubscribeAdapter: (() => void) | null = null
  private unsubscribeQueue: (() => void) | null = null
  private state: PlayerState = { ...initialPlayerState }
  /** Инкремент при каждом playTrack — отсекает устаревшие async resolve/play. */
  private playGeneration = 0

  constructor(adapter?: PlayerAdapter) {
    this.adapter = adapter ?? getPlayerManager()
    const queue = getPlaybackQueue()
    const snap = queue.getSnapshot()

    this.state = {
      ...initialPlayerState,
      volume: this.adapter.getVolume(),
      muted: this.adapter.getMuted(),
      playbackRate: this.adapter.getPlaybackRate(),
      queue: snap.items,
      queueIndex: snap.currentIndex,
      currentTrack: queue.current(),
    }

    this.unsubscribeQueue = queue.subscribe((snapshot) => {
      // Не подменяем currentTrack из очереди во время switch — иначе UI
      // покажет B до реального load/play.
      this.patchState({
        queue: snapshot.items,
        queueIndex: snapshot.currentIndex,
      })
    })

    this.unsubscribeAdapter = this.adapter.subscribe((event) => {
      // Во время pending switch не даём stale timeupdate старого backend
      // переписывать прогресс так, будто уже играет новый трек.
      if (this.state.pendingTrack && event.type === 'timeupdate') {
        return
      }

      const duration = event.duration || this.state.duration
      const currentTime = event.currentTime
      const timePatch = {
        currentTime,
        duration,
        progress: computeProgress(currentTime, duration),
        volume: event.volume,
        muted: event.muted ?? this.state.muted,
        playbackRate: event.playbackRate ?? this.state.playbackRate,
      }

      switch (event.type) {
        case 'error': {
          const blocked = isAutoplayBlockedError(new Error(event.error ?? 'Playback error'))
          const message = blocked ? null : (event.error ?? 'Playback error')
          this.patchState({
            ...timePatch,
            playing: false,
            paused: true,
            buffering: false,
            loading: false,
            error: message,
          })
          if (!blocked && !this.state.pendingTrack && message) {
            emitPlaybackMediaError(this.state.currentTime)
          }
          return
        }
        case 'ended':
          if (this.state.pendingTrack) {
            return
          }
          this.patchState({
            ...timePatch,
            playing: false,
            paused: false,
            buffering: false,
            loading: false,
          })
          reportPlayback({
            type: 'ended',
            positionMs: Math.max(0, Math.round(currentTime * 1000)),
            durationMs: Math.max(0, Math.round((duration || this.state.duration) * 1000)) || null,
          })
          void this.advanceFromEnded()
          return
        case 'timeupdate':
          if (!this.state.pendingTrack) {
            reportPlayback({
              type: 'time',
              positionMs: Math.max(0, Math.round(currentTime * 1000)),
            })
            this.patchState(timePatch)
          }
          return
        case 'play':
          if (this.state.pendingTrack) {
            // play() backend до commit currentTrack — игнорируем, commit сделает playTrack.
            return
          }
          this.patchState({
            ...timePatch,
            playing: true,
            paused: false,
            buffering: false,
            loading: false,
            error: null,
          })
          return
        case 'pause':
        case 'stop':
          if (this.state.pendingTrack && event.type === 'pause') {
            // Ожидаемый pause старого трека при старте switch.
            return
          }
          this.patchState({
            ...timePatch,
            playing: false,
            paused: true,
            buffering: false,
          })
          return
        case 'waiting':
        case 'loadstart':
          this.patchState({
            ...timePatch,
            buffering: true,
            loading: event.type === 'loadstart' ? true : this.state.loading,
          })
          return
        case 'canplay':
        case 'loadedmetadata':
          this.patchState({
            buffering: false,
            loading: this.state.pendingTrack ? true : false,
          })
          return
        default:
          if (!this.state.pendingTrack) {
            this.patchState(timePatch)
          }
      }
    })
  }

  getState(): PlayerState {
    return this.state
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setQueue(
    tracks: Track[],
    startIndex = 0,
    context?: PlaybackContext,
  ): void {
    getPlaybackQueue().setQueue(tracks, startIndex, context)
    this.patchState({
      queue: getPlaybackQueue().getItems(),
      queueIndex: getPlaybackQueue().getSnapshot().currentIndex,
    })
  }

  append(tracks: Track[]): void {
    getPlaybackQueue().append(tracks)
  }

  insertNext(track: Track): void {
    getPlaybackQueue().insertNext(track)
  }

  /**
   * Низкоуровневый play URL. Не меняет currentTrack —
   * identity коммитит только playTrack после успешного load.
   */
  async play(url: string, generation = this.playGeneration): Promise<void> {
    try {
      this.patchState({ loading: true, buffering: true, error: null })
      await this.adapter.load(url)
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'after-await',
        }) === 'abandon-silent'
      ) {
        return
      }
      await this.adapter.play()
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'after-await',
        }) === 'abandon-silent'
      ) {
        return
      }
      this.patchState({ error: null, loading: false, buffering: false })
    } catch (error) {
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'on-error',
          isAbortError: isAbortError(error),
        }) === 'abandon-silent'
      ) {
        return
      }

      if (isAutoplayBlockedError(error)) {
        this.patchState({
          playing: false,
          paused: true,
          loading: false,
          buffering: false,
          error: null,
        })
        throw error
      }

      this.patchState({
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error: error instanceof Error ? error.message : 'Failed to play',
      })
      throw error
    }
  }

  async playTrack(track: Track, options?: { preserveQueue?: boolean }): Promise<void> {
    reportPlayback({
      type: 'intent',
      sourceId: track.sourceId,
      externalId: track.externalId,
      canonicalTrackId: null,
      preserveQueue: options?.preserveQueue === true,
    })
    // Статус запуска — до сети и fallback, чтобы кнопка не молчала.
    this.armPlayback(track)
    if (!options?.preserveQueue) {
      cancelActiveFallback('manual-play')
      this.adoptRequestedTrack(track)
      const route = await routeLivePlayback(track, (requested) => this.playResolved(requested))
      if (route.handled) {
        return
      }
    }
    await this.playResolved(track)
  }

  /** Сразу помечает запрошенный трек. currentTrack не меняется, пока источник не загружен. */
  private armPlayback(track: Track): void {
    const queue = getPlaybackQueue()
    this.patchState({
      pendingTrack: track,
      loading: true,
      buffering: true,
      playing: false,
      paused: true,
      error: null,
      queue: queue.getItems(),
      queueIndex: queue.getSnapshot().currentIndex,
    })
  }

  /**
   * Индекс очереди ставится на запрошенный source Track один раз.
   * Смена SourceCopy внутри fallback сюда не возвращается.
   */
  private adoptRequestedTrack(track: Track): void {
    const queue = getPlaybackQueue()
    if (!queue.getItems().some((item) => item.id === track.id)) {
      const before = queue.getSnapshot()
      noteSearchFlowEvent({
        source: 'AudioPlayer.adoptRequestedTrack',
        contextBefore: before.context.type,
        contextAfter: 'none',
        queueLengthBefore: before.items.length,
        queueLengthAfter: 1,
        currentIndex: before.currentIndex,
        trackId: track.id,
        nextSource: 'unknown',
        detail: 'track-missing-from-queue→setQueue(none)',
      })
      queue.setQueue([track], 0, { type: 'none' })
    } else {
      queue.focusTrack(track.id)
    }
  }

  private async playResolved(track: Track): Promise<void> {
    const generation = ++this.playGeneration
    const queue = getPlaybackQueue()
    this.patchState({
      pendingTrack: track,
      loading: true,
      buffering: true,
      playing: false,
      paused: true,
      error: null,
      queue: queue.getItems(),
      queueIndex: queue.getSnapshot().currentIndex,
    })
    // Пауза предыдущего источника идёт параллельно с поиском URL.
    const pausePromise = Promise.resolve(this.adapter.pause())

    const resolver = getPlaybackResolver()
    let playbackUrl: string | null = null
    let candidate: PlaybackCandidate | null = null

    try {
      const resolution = await resolver.resolve(track)
      if (generation !== this.playGeneration) {
        return
      }
      if (!resolution) {
        this.adapter.pause()
        const message = resolver.buildUnavailableMessage()
        this.patchState({
          pendingTrack: null,
          activeCandidate: null,
          playing: false,
          paused: true,
          loading: false,
          buffering: false,
          error: message,
        })
        reportPlayback({
          type: 'failed',
          sourceId: track.sourceId,
          externalId: track.externalId,
          canonicalTrackId: null,
          reason: 'load-failed',
        })
        throw new PlaybackResolveError(message)
      }
      playbackUrl = resolution.url
      candidate = resolution.candidate
    } catch (error) {
      if (generation !== this.playGeneration) {
        return
      }
      if (error instanceof PlaybackResolveError) {
        throw error
      }
      this.adapter.pause()
      const message =
        error instanceof Error ? error.message : 'Failed to resolve playback'
      this.patchState({
        pendingTrack: null,
        activeCandidate: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error: message,
      })
      reportPlayback({
        type: 'failed',
        sourceId: track.sourceId,
        externalId: track.externalId,
        canonicalTrackId: null,
        reason: 'load-failed',
      })
      throw error instanceof Error ? error : new Error(message)
    }

    await pausePromise.catch(() => undefined)
    if (generation !== this.playGeneration) {
      return
    }

    const trackWithUrl: Track = { ...track, previewUrl: playbackUrl }

    try {
      await this.adapter.load(playbackUrl)
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'after-await',
        }) === 'abandon-silent'
      ) {
        return
      }

      // Commit identity только после успешного load нового источника.
      this.patchState({
        currentTrack: trackWithUrl,
        pendingTrack: null,
        activeCandidate: candidate,
        currentTime: 0,
        duration: track.durationMs ? track.durationMs / 1000 : 0,
        progress: 0,
        error: null,
        loading: true,
        buffering: true,
        queue: queue.getItems(),
        queueIndex: queue.getSnapshot().currentIndex,
      })

      await this.adapter.play()
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'after-await',
        }) === 'abandon-silent'
      ) {
        return
      }

      this.patchState({
        playing: true,
        paused: false,
        loading: false,
        buffering: false,
        error: null,
      })
      {
        const snap = getPlaybackQueue().getSnapshot()
        noteSearchFlowEvent({
          source: 'AudioPlayer.playStart',
          contextBefore: snap.context.type,
          contextAfter: snap.context.type,
          queueLengthBefore: snap.items.length,
          queueLengthAfter: snap.items.length,
          currentIndex: snap.currentIndex,
          trackId: track.id,
          detail: 'audible-start',
        })
      }
      reportPlayback({
        type: 'audible',
        sourceId: track.sourceId,
        externalId: track.externalId,
        canonicalTrackId: null,
        positionMs: 0,
        durationMs: track.durationMs ?? null,
      })
    } catch (error) {
      if (
        settlePlayGeneration({
          attemptGeneration: generation,
          currentPlayGeneration: this.playGeneration,
          phase: 'on-error',
          isAbortError: isAbortError(error),
        }) === 'abandon-silent'
      ) {
        return
      }

      if (isAutoplayBlockedError(error)) {
        // Трек загружен, autoplay блокирован — currentTrack уже B, на паузе.
        this.patchState({
          pendingTrack: null,
          playing: false,
          paused: true,
          loading: false,
          buffering: false,
          error: null,
        })
        throw error
      }

      this.adapter.pause()
      this.patchState({
        pendingTrack: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error: error instanceof Error ? error.message : 'Failed to play',
      })
      reportPlayback({
        type: 'failed',
        sourceId: track.sourceId,
        externalId: track.externalId,
        canonicalTrackId: null,
        reason: 'playback-failed',
      })
      throw error
    }
  }

  pause(): void {
    reportPlayback({
      type: 'paused',
      positionMs: Math.max(0, Math.round(this.state.currentTime * 1000)),
    })
    void Promise.resolve(this.adapter.pause())
    this.patchState({
      playing: false,
      paused: true,
      pendingTrack: null,
      loading: false,
      buffering: false,
    })
  }

  async resume(): Promise<void> {
    const track = this.state.currentTrack ?? getPlaybackQueue().current()
    if (!track) {
      return
    }

    if (this.adapter.getDuration() > 0 || this.adapter.getCurrentTime() > 0) {
      try {
        await this.adapter.play()
        this.patchState({
          playing: true,
          paused: false,
          pendingTrack: null,
          error: null,
        })
        reportPlayback({
          type: 'resumed',
          positionMs: Math.max(0, Math.round(this.adapter.getCurrentTime() * 1000)),
        })
      } catch (error) {
        if (isAutoplayBlockedError(error)) {
          this.patchState({ error: null })
          return
        }
        this.patchState({
          error: error instanceof Error ? error.message : 'Failed to resume',
        })
      }
      return
    }

    await this.playTrack(track)
  }

  clearOwnedPlaybackError(): void {
    if (!this.state.error) {
      return
    }
    this.patchState({ error: null })
  }

  stop(): void {
    reportPlayback({
      type: 'skip',
      reason: 'stop',
      positionMs: Math.max(0, Math.round(this.state.currentTime * 1000)),
    })
    cancelActiveFallback('stop')
    this.playGeneration += 1
    this.adapter.stop()
    this.patchState({
      playing: false,
      paused: true,
      pendingTrack: null,
      currentTime: 0,
      progress: 0,
      buffering: false,
      loading: false,
    })
  }

  seek(timeSeconds: number): void {
    if (this.state.pendingTrack) {
      return
    }
    this.adapter.seek(timeSeconds)
    reportPlayback({
      type: 'seek',
      positionMs: Math.max(0, Math.round(timeSeconds * 1000)),
    })
    const currentTime = this.adapter.getCurrentTime()
    const duration = this.adapter.getDuration() || this.state.duration
    this.patchState({
      currentTime,
      duration,
      progress: computeProgress(currentTime, duration),
    })
  }

  async next(): Promise<void> {
    const queue = getPlaybackQueue()
    const before = queue.getSnapshot()
    noteSearchFlowEvent({
      source: 'AudioPlayer.next',
      contextBefore: before.context.type,
      queueLengthBefore: before.items.length,
      currentIndex: before.currentIndex,
      trackId: queue.current()?.id ?? null,
      detail: `peekNext=${queue.peekNext()?.id ? 'yes' : 'no'}`,
    })
    reportPlayback({
      type: 'skip',
      reason: 'next',
      positionMs: Math.max(0, Math.round(this.state.currentTime * 1000)),
    })
    if (isRecommendationAdvanceContext(queue.getPlaybackContext())) {
      // После Previous снова можно идти по хвосту истории; exhausted только на самом конце.
      if (isRecommendationExhausted() && !queue.peekNext()) {
        noteSearchFlowEvent({
          source: 'AudioPlayer.next',
          contextBefore: before.context.type,
          trackId: queue.current()?.id ?? null,
          detail: 'exhausted→ignore',
        })
        return
      }
      if (isRecommendationExhausted() && queue.peekNext()) {
        clearRecommendationExhausted()
      }
      await this.playRecommendationAdvance(false)
      return
    }
    const holder: { track: Track | null } = { track: null }
    beginQueueTransport('next', () => {
      holder.track = getPlaybackQueue().next()
    })
    if (!holder.track) {
      this.stop()
      this.patchState({
        currentTrack: null,
        pendingTrack: null,
        activeCandidate: null,
        queueIndex: -1,
      })
      return
    }
    const after = getPlaybackQueue().getSnapshot()
    noteSearchFlowEvent({
      source: 'AudioPlayer.next→queue.next',
      contextBefore: before.context.type,
      contextAfter: after.context.type,
      queueLengthBefore: before.items.length,
      queueLengthAfter: after.items.length,
      currentIndex: after.currentIndex,
      trackId: holder.track.id,
      nextSource: 'queue',
      detail: 'non-recommendation path',
    })
    await this.playTrack(holder.track)
  }

  async previous(): Promise<void> {
    let restart = false
    beginQueueTransport('previous', () => {
      restart = this.state.currentTime > 3 && !this.state.pendingTrack
    })
    if (restart) {
      this.seek(0)
      if (!this.state.playing) {
        await this.resume()
      }
      return
    }

    // Сброс prefetch + inflight Next: быстрое Previous не должно проиграть устаревшую рекомендацию.
    invalidateRecommendationAdvance()
    getContinuationSession().cancel()
    clearRecommendationExhausted()

    const track = getPlaybackQueue().previous()
    if (!track) {
      return
    }
    if (track.id !== this.state.currentTrack?.id) {
      reportPlayback({
        type: 'skip',
        reason: 'previous',
        positionMs: Math.max(0, Math.round(this.state.currentTime * 1000)),
      })
    }
    await this.playTrack(track)
  }

  setVolume(volume: number): void {
    this.adapter.setVolume(volume)
    this.patchState({ volume: this.adapter.getVolume() })
  }

  setMuted(muted: boolean): void {
    this.adapter.setMuted(muted)
    this.patchState({ muted: this.adapter.getMuted() })
  }

  toggleMute(): void {
    this.setMuted(!this.state.muted)
  }

  setPlaybackRate(rate: number): void {
    this.adapter.setPlaybackRate(rate)
    this.patchState({ playbackRate: this.adapter.getPlaybackRate() })
  }

  dispose(): void {
    this.unsubscribeAdapter?.()
    this.unsubscribeAdapter = null
    this.unsubscribeQueue?.()
    this.unsubscribeQueue = null
    this.adapter.dispose()
    this.listeners.clear()
  }

  private async advanceFromEnded(): Promise<void> {
    const queue = getPlaybackQueue()
    const before = queue.getSnapshot()
    noteSearchFlowEvent({
      source: 'AudioPlayer.advanceFromEnded',
      contextBefore: before.context.type,
      queueLengthBefore: before.items.length,
      currentIndex: before.currentIndex,
      trackId: queue.current()?.id ?? null,
      detail: 'ended',
    })
    if (isRecommendationAdvanceContext(queue.getPlaybackContext())) {
      if (isRecommendationExhausted() && !queue.peekNext()) {
        noteSearchFlowEvent({
          source: 'AudioPlayer.advanceFromEnded',
          contextBefore: before.context.type,
          trackId: queue.current()?.id ?? null,
          detail: 'exhausted→ignore',
        })
        return
      }
      if (isRecommendationExhausted() && queue.peekNext()) {
        clearRecommendationExhausted()
      }
      await this.playRecommendationAdvance(true)
      return
    }
    const track = getPlaybackQueue().next({ fromEnded: true })
    if (!track) {
      this.stop()
      this.patchState({
        currentTrack: null,
        pendingTrack: null,
        activeCandidate: null,
        queueIndex: -1,
      })
      return
    }
    noteSearchFlowEvent({
      source: 'AudioPlayer.advanceFromEnded→queue.next',
      contextBefore: before.context.type,
      contextAfter: getPlaybackQueue().getPlaybackContext().type,
      queueLengthAfter: getPlaybackQueue().getItems().length,
      currentIndex: getPlaybackQueue().getSnapshot().currentIndex,
      trackId: track.id,
      nextSource: 'queue',
      detail: 'non-recommendation ended',
    })
    await this.playTrack(track)
  }

  /**
   * Единый advance для search-seed / swipe / wave recommendation session.
   * Сериализует быстрые Next и ждёт inflight prepare (гонка INTEGRATION-02).
   */
  private async playRecommendationAdvance(fromEnded: boolean): Promise<void> {
    const epoch = getRecommendationAdvanceEpoch()
    let advanced: {
      track: Track
      fromId: string | null
      walkingHistory: boolean
    } | null = null
    try {
      advanced = await enqueueRecommendationAdvance(async () => {
        if (epoch !== getRecommendationAdvanceEpoch()) {
          return null
        }
        const session = getContinuationSession()
        const queue = getPlaybackQueue()
        const before = queue.getSnapshot()
        const fromId = queue.current()?.id ?? null
        // Уже есть трек впереди в истории/хвосте — Recommendation Engine не зовём.
        const walkingHistory = Boolean(queue.peekNext())
        noteSearchFlowEvent({
          source: 'AudioPlayer.playRecommendationAdvance',
          contextBefore: before.context.type,
          queueLengthBefore: before.items.length,
          currentIndex: before.currentIndex,
          trackId: fromId,
          detail: fromEnded
            ? walkingHistory
              ? 'fromEnded:history'
              : 'fromEnded'
            : walkingHistory
              ? 'fromNext:history'
              : 'fromNext',
        })
        const resolved = await resolveRecommendationAdvance(queue, session, { fromEnded })
        if (epoch !== getRecommendationAdvanceEpoch()) {
          return null
        }
        if (!resolved) {
          noteSearchFlowEvent({
            source: 'AudioPlayer.playRecommendationAdvance',
            contextBefore: before.context.type,
            contextAfter: queue.getPlaybackContext().type,
            queueLengthAfter: queue.getItems().length,
            currentIndex: queue.getSnapshot().currentIndex,
            trackId: fromId,
            detail: 'no-candidate→stop',
          })
          return null
        }
        noteSearchFlowEvent({
          source: 'AudioPlayer.playRecommendationAdvance→playTrack',
          contextBefore: before.context.type,
          contextAfter: queue.getPlaybackContext().type,
          queueLengthAfter: queue.getItems().length,
          currentIndex: queue.getSnapshot().currentIndex,
          trackId: resolved.id,
          nextSource: walkingHistory ? 'queue' : 'continuation',
          detail: fromEnded ? 'ended-track' : 'next-track',
        })
        return { track: resolved, fromId, walkingHistory }
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      throw error
    }

    if (epoch !== getRecommendationAdvanceEpoch()) {
      return
    }

    if (!advanced) {
      // Сохраняем последнюю рекомендацию для карточки; не сбрасываем queueIndex на -1
      // (иначе focus падает на queue[0] и Home выглядит как search hits).
      const lastTrack =
        this.state.currentTrack ?? this.state.pendingTrack ?? getPlaybackQueue().current()
      const liveIndex = getPlaybackQueue().getSnapshot().currentIndex
      markRecommendationExhausted()
      this.stop()
      this.patchState({
        currentTrack: lastTrack,
        pendingTrack: null,
        activeCandidate: null,
        queueIndex: liveIndex >= 0 ? liveIndex : this.state.queueIndex,
        playing: false,
        paused: true,
      })
      return
    }

    await this.playTrack(advanced.track)
    if (epoch !== getRecommendationAdvanceEpoch()) {
      return
    }
    // Prefetch только после новой рекомендации на конце истории — не при Previous/Next по хвосту.
    if (!advanced.walkingHistory && advanced.track.id !== advanced.fromId) {
      prepareRecommendationFollowUp(
        getContinuationSession(),
        advanced.track,
        getPlaybackQueue().getPlaybackContext(),
      )
    }
  }

  private patchState(partial: Partial<PlayerState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

let singleton: AudioPlayer | null = null

export function getAudioPlayer(): AudioPlayer {
  if (!singleton) {
    singleton = new AudioPlayer()
    attachMediaSession(singleton)
  }
  return singleton
}
