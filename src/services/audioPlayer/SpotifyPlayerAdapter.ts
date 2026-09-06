import { getSpotifyAdapter } from '../../sources/adapters/spotify'
import type {
  PlayerAdapter,
  PlayerAdapterEvent,
  PlayerAdapterEventType,
} from './PlayerAdapter'
import type {
  SpotifyWebPlaybackPlayer,
  SpotifyWebPlaybackState,
} from './spotifyWebPlaybackTypes'

const SDK_SCRIPT_SRC = 'https://sdk.scdn.co/spotify-player.js'
const DEVICE_NAME = 'SwipeMusic'
const SOURCE_ID = 'spotify'

export type PlaybackDeviceStatus = {
  sourceId: string
  connected: boolean
  deviceName: string | null
  deviceId: string | null
}

let sdkLoadPromise: Promise<void> | null = null

function loadSpotifySdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Spotify SDK: только в браузере'))
  }
  if (window.Spotify) {
    return Promise.resolve()
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise
  }

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      previous?.()
      resolve()
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SCRIPT_SRC}"]`,
    )
    if (existing) {
      return
    }

    const script = document.createElement('script')
    script.src = SDK_SCRIPT_SRC
    script.async = true
    script.onerror = () => {
      sdkLoadPromise = null
      reject(new Error('Не удалось загрузить Spotify Web Playback SDK'))
    }
    document.body.appendChild(script)
  })

  return sdkLoadPromise
}

/**
 * PlayerAdapter для Spotify Web Playback SDK.
 * OAuth — только через существующий SpotifyAdapter (без дублирования).
 */
export class SpotifyPlayerAdapter implements PlayerAdapter {
  readonly sourceId = SOURCE_ID

  private readonly listeners = new Set<(event: PlayerAdapterEvent) => void>()
  private player: SpotifyWebPlaybackPlayer | null = null
  private deviceId: string | null = null
  private deviceReady = false
  private pendingUri: string | null = null
  private currentTimeSec = 0
  private durationSec = 0
  private volume = 0.8
  private readyPromise: Promise<void> | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private endedEmitted = false
  private elementActivated = false

  canHandleUrl(url: string): boolean {
    return url.startsWith('spotify:')
  }

  getDeviceStatus(): PlaybackDeviceStatus {
    return {
      sourceId: SOURCE_ID,
      connected: this.deviceReady && this.deviceId != null,
      deviceName: this.deviceReady ? DEVICE_NAME : null,
      deviceId: this.deviceId,
    }
  }

  async ensureConnected(): Promise<void> {
    await this.ensurePlayer()
  }

  async reconnect(): Promise<void> {
    this.disposePlayerOnly()
    this.readyPromise = null
    await this.ensurePlayer()
  }

  async load(url: string): Promise<void> {
    if (!url.startsWith('spotify:')) {
      throw new Error('SpotifyPlayerAdapter: ожидается spotify: URI')
    }
    await this.ensurePlayer()
    this.pendingUri = url
    this.endedEmitted = false
    this.currentTimeSec = 0
    this.durationSec = 0
    this.emit('loadedmetadata')
  }

  async play(): Promise<void> {
    await this.ensurePlayer()
    if (!this.deviceId) {
      throw new Error('Spotify device ещё не готов')
    }

    await this.activateElementOnce()

    const api = getSpotifyAdapter().getApiClient()
    const uri = this.pendingUri

    if (uri) {
      await api.transferPlayback(this.deviceId, false)
      await api.startPlayback({
        deviceId: this.deviceId,
        uris: [uri],
        positionMs: 0,
      })
      this.pendingUri = null
    } else {
      await this.player?.resume()
    }

    this.startTicker()
    this.emit('play')
  }

  pause(): void {
    void this.player?.pause().then(() => {
      this.stopTicker()
      this.emit('pause')
    })
  }

  /** Resume — alias play() без нового URI (контракт AudioPlayer.resume). */
  async resume(): Promise<void> {
    await this.play()
  }

  stop(): void {
    void this.player?.pause().then(() => {
      this.currentTimeSec = 0
      this.stopTicker()
      this.emit('stop')
    })
  }

  seek(timeSeconds: number): void {
    if (!Number.isFinite(timeSeconds) || !this.deviceId) {
      return
    }
    const ms = Math.max(0, timeSeconds) * 1000
    void this.player?.seek(ms).then(() => {
      this.currentTimeSec = timeSeconds
      this.emit('timeupdate')
    })
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    void this.player?.setVolume(this.volume).then(() => {
      this.emit('volumechange')
    })
  }

  async next(): Promise<void> {
    await this.player?.nextTrack()
  }

  async previous(): Promise<void> {
    await this.player?.previousTrack()
  }

  getCurrentTime(): number {
    return this.currentTimeSec
  }

  getDuration(): number {
    return this.durationSec
  }

  getVolume(): number {
    return this.volume
  }

  subscribe(listener: (event: PlayerAdapterEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.stopTicker()
    this.disposePlayerOnly()
    this.listeners.clear()
  }

  /** Сброс device при Disconnect источника (без очистки подписчиков PlayerManager). */
  disconnectSession(): void {
    this.disposePlayerOnly()
    this.readyPromise = null
    this.pendingUri = null
    this.elementActivated = false
  }

  private disposePlayerOnly(): void {
    this.stopTicker()
    if (this.player) {
      this.player.removeListener('ready')
      this.player.removeListener('not_ready')
      this.player.removeListener('player_state_changed')
      this.player.disconnect()
      this.player = null
    }
    this.deviceId = null
    this.deviceReady = false
  }

  private async ensurePlayer(): Promise<void> {
    if (this.player && this.deviceReady) {
      return
    }
    if (this.readyPromise) {
      await this.readyPromise
      return
    }

    this.readyPromise = this.createPlayer()
    try {
      await this.readyPromise
    } catch (error) {
      this.readyPromise = null
      throw error
    }
  }

  private async createPlayer(): Promise<void> {
    await loadSpotifySdk()
    if (!window.Spotify) {
      throw new Error('Spotify Web Playback SDK не загружен')
    }

    // Проверка сессии до создания player.
    await getSpotifyAdapter().resolveAccessToken()

    const player = new window.Spotify.Player({
      name: DEVICE_NAME,
      volume: this.volume,
      getOAuthToken: (cb) => {
        void getSpotifyAdapter()
          .resolveAccessToken()
          .then((token) => cb(token))
          .catch(() => cb(''))
      },
    })

    this.player = player

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Spotify device: timeout ready'))
      }, 15_000)

      player.addListener('ready', ({ device_id }) => {
        this.deviceId = device_id
        this.deviceReady = true
        window.clearTimeout(timeout)
        resolve()
      })

      player.addListener('not_ready', () => {
        this.deviceReady = false
      })

      player.addListener('initialization_error', ({ message }) => {
        window.clearTimeout(timeout)
        reject(new Error(message))
      })
      player.addListener('authentication_error', ({ message }) => {
        window.clearTimeout(timeout)
        reject(new Error(message))
      })
      player.addListener('account_error', ({ message }) => {
        window.clearTimeout(timeout)
        reject(
          new Error(
            message ||
              'Spotify Premium обязателен для Web Playback SDK',
          ),
        )
      })
      player.addListener('playback_error', ({ message }) => {
        this.emit('error', message)
      })

      player.addListener('player_state_changed', (state) => {
        this.onPlayerStateChanged(state)
      })

      void player.connect().then((ok) => {
        if (!ok) {
          window.clearTimeout(timeout)
          reject(new Error('Spotify player.connect() вернул false'))
        }
      })
    })
  }

  private async activateElementOnce(): Promise<void> {
    if (this.elementActivated || !this.player) {
      return
    }
    try {
      await this.player.activateElement()
      this.elementActivated = true
    } catch {
      // Браузер без ограничений autoplay — ок.
    }
  }

  private onPlayerStateChanged(state: SpotifyWebPlaybackState | null): void {
    if (!state) {
      this.stopTicker()
      this.emit('pause')
      return
    }

    this.currentTimeSec = state.position / 1000
    this.durationSec = state.duration / 1000

    if (state.paused) {
      this.stopTicker()
      const nearEnd =
        state.duration > 0 && state.position >= state.duration - 800
      if (nearEnd && !this.endedEmitted) {
        this.endedEmitted = true
        this.emit('ended')
        return
      }
      this.emit('pause')
      return
    }

    this.endedEmitted = false
    this.startTicker()
    this.emit('timeupdate')
    this.emit('play')
  }

  private startTicker(): void {
    if (this.ticker) {
      return
    }
    this.ticker = setInterval(() => {
      void this.player?.getCurrentState().then((state) => {
        if (!state || state.paused) {
          return
        }
        this.currentTimeSec = state.position / 1000
        this.durationSec = state.duration / 1000
        this.emit('timeupdate')
      })
    }, 500)
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
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
