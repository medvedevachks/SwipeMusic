import type {
  PlayerAdapter,
  PlayerAdapterEvent,
  PlayerAdapterEventType,
} from './PlayerAdapter'

/**
 * Первая реализация PlayerAdapter на стандартном HTMLAudioElement.
 * Не экспортируется в UI — только через AudioPlayer.
 */
export class HtmlAudioPlayerAdapter implements PlayerAdapter {
  private readonly audio: HTMLAudioElement
  private readonly listeners = new Set<(event: PlayerAdapterEvent) => void>()

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'metadata'

    this.audio.addEventListener('play', () => this.emit('play'))
    this.audio.addEventListener('pause', () => this.emit('pause'))
    this.audio.addEventListener('ended', () => this.emit('ended'))
    this.audio.addEventListener('timeupdate', () => this.emit('timeupdate'))
    this.audio.addEventListener('loadedmetadata', () => this.emit('loadedmetadata'))
    this.audio.addEventListener('volumechange', () => this.emit('volumechange'))
    this.audio.addEventListener('error', () => {
      const mediaError = this.audio.error
      const message =
        mediaError?.message ||
        `Audio error code ${mediaError?.code ?? 'unknown'}`
      this.emit('error', message)
    })
  }

  async load(url: string): Promise<void> {
    if (this.audio.src === url && !this.audio.error) {
      return
    }

    this.audio.src = url
    this.audio.load()

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error('Failed to load audio source'))
      }
      const cleanup = () => {
        this.audio.removeEventListener('canplay', onReady)
        this.audio.removeEventListener('error', onError)
      }

      this.audio.addEventListener('canplay', onReady, { once: true })
      this.audio.addEventListener('error', onError, { once: true })
    })
  }

  async play(): Promise<void> {
    await this.audio.play()
  }

  pause(): void {
    this.audio.pause()
  }

  stop(): void {
    this.audio.pause()
    this.audio.currentTime = 0
    this.emit('stop')
  }

  seek(timeSeconds: number): void {
    if (!Number.isFinite(timeSeconds)) {
      return
    }
    this.audio.currentTime = Math.max(0, timeSeconds)
    this.emit('timeupdate')
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume))
  }

  getCurrentTime(): number {
    return this.audio.currentTime || 0
  }

  getDuration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  getVolume(): number {
    return this.audio.volume
  }

  subscribe(listener: (event: PlayerAdapterEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.listeners.clear()
  }

  private emit(type: PlayerAdapterEventType, error?: string): void {
    const event: PlayerAdapterEvent = {
      type,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      volume: this.getVolume(),
      error,
    }

    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
