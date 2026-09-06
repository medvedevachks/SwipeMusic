import type { PlayerState } from '../../types/player'
import { initialPlayerState } from '../../types/player'
import type { Track } from '../../types/track'
import { resolvePlaybackUrl } from '../../sources/resolvePlaybackUrl'
import { HtmlAudioPlayerAdapter } from './HtmlAudioPlayerAdapter'
import type { PlayerAdapter } from './PlayerAdapter'

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

/**
 * Независимый от React сервис воспроизведения.
 * Бизнес-логика очереди и состояния; адаптер сменяем.
 */
export class AudioPlayer {
  private readonly adapter: PlayerAdapter
  private readonly listeners = new Set<StateListener>()
  private unsubscribeAdapter: (() => void) | null = null
  private state: PlayerState = { ...initialPlayerState }

  constructor(adapter?: PlayerAdapter) {
    this.adapter = adapter ?? new HtmlAudioPlayerAdapter()
    this.state = {
      ...initialPlayerState,
      volume: this.adapter.getVolume(),
    }

    this.unsubscribeAdapter = this.adapter.subscribe((event) => {
      const timePatch = {
        currentTime: event.currentTime,
        duration: event.duration || this.state.duration,
        volume: event.volume,
      }

      switch (event.type) {
        case 'error':
          this.patchState({
            ...timePatch,
            playing: false,
            paused: true,
            error: isAutoplayBlockedError(
              new Error(event.error ?? 'Playback error'),
            )
              ? null
              : (event.error ?? 'Playback error'),
          })
          return
        case 'ended':
          this.patchState({
            ...timePatch,
            playing: false,
            paused: false,
          })
          void this.next()
          return
        case 'play':
          this.patchState({
            ...timePatch,
            playing: true,
            paused: false,
            error: null,
          })
          return
        case 'pause':
        case 'stop':
          this.patchState({
            ...timePatch,
            playing: false,
            paused: true,
          })
          return
        default:
          this.patchState(timePatch)
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

  setQueue(tracks: Track[], startIndex = 0): void {
    // previewUrl может появиться позже через getStream — не отбрасываем локальные треки.
    const queue = tracks.filter(
      (track) => Boolean(track.previewUrl) || Boolean(track.sourceId),
    )
    const queueIndex =
      queue.length === 0
        ? -1
        : Math.min(Math.max(0, startIndex), queue.length - 1)

    this.patchState({
      queue,
      queueIndex,
      currentTrack: queueIndex >= 0 ? queue[queueIndex] : null,
    })
  }

  /** Воспроизвести URL напрямую. */
  async play(url: string): Promise<void> {
    try {
      await this.adapter.load(url)
      await this.adapter.play()
      this.patchState({ error: null })
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        this.patchState({
          playing: false,
          paused: true,
          error: null,
        })
        throw error
      }

      this.patchState({
        playing: false,
        paused: true,
        error: error instanceof Error ? error.message : 'Failed to play',
      })
      throw error
    }
  }

  async playTrack(track: Track): Promise<void> {
    let playbackUrl: string | null
    try {
      playbackUrl = await resolvePlaybackUrl(track)
    } catch (error) {
      this.patchState({
        currentTrack: track,
        playing: false,
        paused: true,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve playback URL',
      })
      return
    }

    if (!playbackUrl) {
      this.patchState({
        currentTrack: track,
        playing: false,
        paused: true,
        error: 'Track has no preview URL',
      })
      return
    }

    const trackWithUrl: Track = { ...track, previewUrl: playbackUrl }
    const existingIndex = this.state.queue.findIndex((item) => item.id === track.id)
    this.patchState({
      currentTrack: trackWithUrl,
      queueIndex: existingIndex >= 0 ? existingIndex : this.state.queueIndex,
      currentTime: 0,
      duration: 0,
      error: null,
    })

    if (existingIndex >= 0) {
      const queue = [...this.state.queue]
      queue[existingIndex] = trackWithUrl
      this.patchState({ queue })
    }

    await this.play(playbackUrl)
  }

  pause(): void {
    this.adapter.pause()
  }

  async resume(): Promise<void> {
    const track = this.state.currentTrack
    if (!track) {
      return
    }

    if (this.adapter.getDuration() > 0 || this.adapter.getCurrentTime() > 0) {
      try {
        await this.adapter.play()
        this.patchState({ error: null })
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
    this.adapter.stop()
    this.patchState({
      playing: false,
      paused: true,
      currentTime: 0,
    })
  }

  seek(timeSeconds: number): void {
    this.adapter.seek(timeSeconds)
    this.patchState({ currentTime: this.adapter.getCurrentTime() })
  }

  async next(): Promise<void> {
    const { queue, queueIndex } = this.state
    if (queue.length === 0) {
      return
    }

    const nextIndex = queueIndex + 1
    if (nextIndex >= queue.length) {
      this.stop()
      this.patchState({
        playing: false,
        paused: true,
        currentTrack: null,
        queueIndex: -1,
      })
      return
    }

    await this.playTrack(queue[nextIndex])
  }

  async previous(): Promise<void> {
    const { queue, queueIndex, currentTime } = this.state
    if (queue.length === 0) {
      return
    }

    if (currentTime > 3 && queueIndex >= 0) {
      this.seek(0)
      if (!this.state.playing) {
        await this.resume()
      }
      return
    }

    const prevIndex = Math.max(0, queueIndex - 1)
    await this.playTrack(queue[prevIndex])
  }

  setVolume(volume: number): void {
    this.adapter.setVolume(volume)
    this.patchState({ volume: this.adapter.getVolume() })
  }

  dispose(): void {
    this.unsubscribeAdapter?.()
    this.unsubscribeAdapter = null
    this.adapter.dispose()
    this.listeners.clear()
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
