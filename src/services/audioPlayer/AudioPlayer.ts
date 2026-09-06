import type { PlayerState } from '../../types/player'
import { initialPlayerState } from '../../types/player'
import type { Track } from '../../types/track'
import { getPlaybackResolver } from '../playbackResolver'
import { getPlaybackQueue } from '../playbackQueue'
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

/**
 * Воспроизведение текущего трека.
 * Порядок — только PlaybackQueue; AudioPlayer не владеет очередью.
 */
export class AudioPlayer {
  private readonly adapter: PlayerAdapter
  private readonly listeners = new Set<StateListener>()
  private unsubscribeAdapter: (() => void) | null = null
  private unsubscribeQueue: (() => void) | null = null
  private state: PlayerState = { ...initialPlayerState }

  constructor(adapter?: PlayerAdapter) {
    this.adapter = adapter ?? getPlayerManager()
    const queue = getPlaybackQueue()
    const snap = queue.getSnapshot()

    this.state = {
      ...initialPlayerState,
      volume: this.adapter.getVolume(),
      queue: snap.items,
      queueIndex: snap.currentIndex,
      currentTrack: queue.current(),
    }

    this.unsubscribeQueue = queue.subscribe((snapshot) => {
      this.patchState({
        queue: snapshot.items,
        queueIndex: snapshot.currentIndex,
        currentTrack: this.state.playing || this.state.paused
          ? this.state.currentTrack?.id === queue.current()?.id
            ? this.state.currentTrack
            : queue.current()
          : queue.current() ?? this.state.currentTrack,
      })
    })

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
          void this.advanceFromEnded()
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
    getPlaybackQueue().setQueue(tracks, startIndex)
    const current = getPlaybackQueue().current()
    this.patchState({
      queue: getPlaybackQueue().getItems(),
      queueIndex: getPlaybackQueue().getSnapshot().currentIndex,
      currentTrack: current,
    })
  }

  append(tracks: Track[]): void {
    getPlaybackQueue().append(tracks)
  }

  insertNext(track: Track): void {
    getPlaybackQueue().insertNext(track)
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
    const queue = getPlaybackQueue()
    if (!queue.getItems().some((item) => item.id === track.id)) {
      queue.setQueue([track], 0)
    } else {
      queue.focusTrack(track.id)
    }

    const resolver = getPlaybackResolver()
    let playbackUrl: string | null = null

    try {
      const resolution = await resolver.resolve(track)
      if (!resolution) {
        this.patchState({
          currentTrack: track,
          playing: false,
          paused: true,
          error: resolver.buildUnavailableMessage(),
        })
        return
      }
      playbackUrl = resolution.url
    } catch (error) {
      this.patchState({
        currentTrack: track,
        playing: false,
        paused: true,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve playback',
      })
      return
    }

    const trackWithUrl: Track = { ...track, previewUrl: playbackUrl }
    this.patchState({
      currentTrack: trackWithUrl,
      queue: queue.getItems(),
      queueIndex: queue.getSnapshot().currentIndex,
      currentTime: 0,
      duration: 0,
      error: null,
    })

    // Маршрутизация адаптера по URL (spotify: / blob: / https:) — PlayerManager.
    await this.play(playbackUrl)
  }

  pause(): void {
    this.adapter.pause()
  }

  async resume(): Promise<void> {
    const track = this.state.currentTrack ?? getPlaybackQueue().current()
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
    const track = getPlaybackQueue().next()
    if (!track) {
      this.stop()
      this.patchState({
        currentTrack: null,
        queueIndex: -1,
      })
      return
    }
    await this.playTrack(track)
  }

  async previous(): Promise<void> {
    const { currentTime } = this.state
    if (currentTime > 3) {
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
