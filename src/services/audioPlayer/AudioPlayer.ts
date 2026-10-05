import {
  computeProgress,
  type PlayerState,
} from '../../types/player'
import { initialPlayerState } from '../../types/player'
import type { PlaybackContext } from '../../types/playbackContext'
import type { Track } from '../../types/track'
import { getPlaybackResolver } from '../playbackResolver'
import type { PlaybackCandidate } from '../playbackResolver'
import { getPlaybackQueue } from '../playbackQueue'
import {
  beginQueueTransport,
  cancelActiveFallback,
  emitPlaybackMediaError,
} from '../runtimeFallback/fallbackControl.ts'
import { routeLivePlayback } from '../runtimeFallback/livePlayback.ts'
import type { PlayerAdapter } from './PlayerAdapter'
import { getPlayerManager } from './PlayerManager'

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
          void this.advanceFromEnded()
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
      if (generation !== this.playGeneration) {
        this.adapter.pause()
        return
      }
      await this.adapter.play()
      if (generation !== this.playGeneration) {
        this.adapter.pause()
        return
      }
      this.patchState({ error: null, loading: false, buffering: false })
    } catch (error) {
      if (isAbortError(error) || generation !== this.playGeneration) {
        this.adapter.pause()
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

  /**
   * Индекс очереди ставится на запрошенный source Track один раз.
   * Смена SourceCopy внутри fallback сюда не возвращается.
   */
  private adoptRequestedTrack(track: Track): void {
    const queue = getPlaybackQueue()
    if (!queue.getItems().some((item) => item.id === track.id)) {
      queue.setQueue([track], 0, { type: 'none' })
    } else {
      queue.focusTrack(track.id)
    }
  }

  private async playResolved(track: Track): Promise<void> {
    const generation = ++this.playGeneration
    const queue = getPlaybackQueue()
    // Сразу глушим любой backend — A не должен продолжать звучать.
    // await: Spotify SDK pause асинхронный (через PlayerManager).
    await Promise.resolve(this.adapter.pause())
    if (generation !== this.playGeneration) {
      return
    }

    this.patchState({
      pendingTrack: track,
      loading: true,
      buffering: true,
      playing: false,
      paused: true,
      error: null,
      queue: queue.getItems(),
      queueIndex: queue.getSnapshot().currentIndex,
      // currentTrack остаётся прежним, пока B не загружен.
    })

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
        this.patchState({
          pendingTrack: null,
          activeCandidate: null,
          playing: false,
          paused: true,
          loading: false,
          buffering: false,
          error: resolver.buildUnavailableMessage(),
        })
        return
      }
      playbackUrl = resolution.url
      candidate = resolution.candidate
    } catch (error) {
      if (generation !== this.playGeneration) {
        return
      }
      this.adapter.pause()
      this.patchState({
        pendingTrack: null,
        activeCandidate: null,
        playing: false,
        paused: true,
        loading: false,
        buffering: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve playback',
      })
      return
    }

    const trackWithUrl: Track = { ...track, previewUrl: playbackUrl }

    try {
      await this.adapter.load(playbackUrl)
      if (generation !== this.playGeneration) {
        this.adapter.pause()
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
      if (generation !== this.playGeneration) {
        this.adapter.pause()
        return
      }

      this.patchState({
        playing: true,
        paused: false,
        loading: false,
        buffering: false,
        error: null,
      })
    } catch (error) {
      if (isAbortError(error) || generation !== this.playGeneration) {
        this.adapter.pause()
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
      throw error
    }
  }

  pause(): void {
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

  stop(): void {
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
    const currentTime = this.adapter.getCurrentTime()
    const duration = this.adapter.getDuration() || this.state.duration
    this.patchState({
      currentTime,
      duration,
      progress: computeProgress(currentTime, duration),
    })
  }

  async next(): Promise<void> {
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

    const track = getPlaybackQueue().previous()
    if (!track) {
      return
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
    await this.playTrack(track)
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
  }
  return singleton
}
