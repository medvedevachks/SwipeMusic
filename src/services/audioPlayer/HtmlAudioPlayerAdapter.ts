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
  private pollTimer: ReturnType<typeof setInterval> | null = null
  /** Инкремент при каждом load — отменяет предыдущий await canplay. */
  private loadGeneration = 0

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'metadata'

    this.audio.addEventListener('play', () => {
      this.startPolling()
      this.emit('play')
    })
    this.audio.addEventListener('pause', () => {
      this.stopPolling()
      this.emit('pause')
    })
    this.audio.addEventListener('ended', () => {
      this.stopPolling()
      this.emit('ended')
    })
    this.audio.addEventListener('timeupdate', () => this.emit('timeupdate'))
    this.audio.addEventListener('loadedmetadata', () =>
      this.emit('loadedmetadata'),
    )
    this.audio.addEventListener('volumechange', () => this.emit('volumechange'))
    this.audio.addEventListener('waiting', () => this.emit('waiting'))
    this.audio.addEventListener('canplay', () => this.emit('canplay'))
    this.audio.addEventListener('loadstart', () => this.emit('loadstart'))
    this.audio.addEventListener('ratechange', () => this.emit('ratechange'))
    this.audio.addEventListener('error', () => {
      const mediaError = this.audio.error
      const message =
        mediaError?.message ||
        `Audio error code ${mediaError?.code ?? 'unknown'}`
      this.emit('error', message)
    })
  }

  async load(url: string): Promise<void> {
    const generation = ++this.loadGeneration

    // Всегда останавливаем текущее воспроизведение до смены src.
    this.audio.pause()
    this.stopPolling()

    const absolute =
      typeof window !== 'undefined'
        ? new URL(url, window.location.href).href
        : url

    if (this.audio.src === absolute && !this.audio.error) {
      return
    }

    // До смены src: pause()/новый load мог отменить этот вызов.
    if (generation !== this.loadGeneration) {
      const error = new Error('Audio load aborted')
      error.name = 'AbortError'
      throw error
    }

    // src сам запускает загрузку. Отдельный load() сбрасывает play(), вызванный сразу после.
    this.audio.preload = 'auto'
    this.audio.src = url

    if (generation !== this.loadGeneration) {
      const error = new Error('Audio load aborted')
      error.name = 'AbortError'
      throw error
    }
  }

  async play(): Promise<void> {
    await this.audio.play()
  }

  pause(): void {
    // Отменяем in-flight play, чтобы устаревший источник не стал playing.
    this.loadGeneration += 1
    this.audio.pause()
    this.stopPolling()
  }

  stop(): void {
    this.loadGeneration += 1
    this.audio.pause()
    this.audio.currentTime = 0
    this.stopPolling()
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

  setMuted(muted: boolean): void {
    this.audio.muted = muted
    this.emit('volumechange')
  }

  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      return
    }
    this.audio.playbackRate = rate
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

  getMuted(): boolean {
    return this.audio.muted
  }

  getPlaybackRate(): number {
    return this.audio.playbackRate || 1
  }

  isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended
  }

  subscribe(listener: (event: PlayerAdapterEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.loadGeneration += 1
    this.stopPolling()
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.listeners.clear()
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return
    }
    this.pollTimer = setInterval(() => {
      if (this.isPlaying()) {
        this.emit('timeupdate')
      }
    }, 250)
  }

  private stopPolling(): void {
    if (!this.pollTimer) {
      return
    }
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private emit(type: PlayerAdapterEventType, error?: string): void {
    const event: PlayerAdapterEvent = {
      type,
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      volume: this.getVolume(),
      muted: this.getMuted(),
      playbackRate: this.getPlaybackRate(),
      error,
    }

    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
