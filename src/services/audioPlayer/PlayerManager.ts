import { LocalPlayerAdapter } from './LocalPlayerAdapter'
import type {
  PlayerAdapter,
  PlayerAdapterEvent,
} from './PlayerAdapter'
import {
  SpotifyPlayerAdapter,
  type PlaybackDeviceStatus,
} from './SpotifyPlayerAdapter'

type SourceBoundAdapter = PlayerAdapter & {
  readonly sourceId: string
  canHandleUrl(url: string): boolean
  getDeviceStatus?: () => PlaybackDeviceStatus
  ensureConnected?: () => Promise<void>
  reconnect?: () => Promise<void>
}

/**
 * Фабрика / маршрутизатор PlayerAdapter.
 * UI и PlayerStore не выбирают адаптер — только URL / sourceId.
 */
export class PlayerManager implements PlayerAdapter {
  private readonly local: LocalPlayerAdapter
  private readonly spotify: SpotifyPlayerAdapter
  private readonly bySourceId: Map<string, SourceBoundAdapter>
  private active: SourceBoundAdapter
  private readonly listeners = new Set<(event: PlayerAdapterEvent) => void>()
  private unsubscribeActive: (() => void) | null = null

  constructor() {
    this.local = new LocalPlayerAdapter()
    this.spotify = new SpotifyPlayerAdapter()
    this.bySourceId = new Map<string, SourceBoundAdapter>()
    this.bySourceId.set(this.local.sourceId, this.local)
    this.bySourceId.set(this.spotify.sourceId, this.spotify)
    this.active = this.local
    this.bindActive(this.active)
  }

  /** Выбор по sourceId трека (без if в UI). */
  activateForSource(sourceId: string): void {
    const next = this.bySourceId.get(sourceId) ?? this.local
    if (next === this.active) {
      return
    }
    this.active.pause()
    this.bindActive(next)
  }

  /** Выбор по playback URL (spotify: → SDK, иначе HTMLAudio). */
  activateForUrl(url: string): void {
    if (this.spotify.canHandleUrl(url)) {
      this.activateForSource(this.spotify.sourceId)
      return
    }
    this.activateForSource(this.local.sourceId)
  }

  getActiveSourceId(): string {
    return this.active.sourceId
  }

  /**
   * Статус device для панели источника.
   * null — у источника нет Web Playback device.
   */
  getDeviceStatus(sourceId: string): PlaybackDeviceStatus | null {
    const adapter = this.bySourceId.get(sourceId)
    return adapter?.getDeviceStatus?.() ?? null
  }

  async prepareDevice(sourceId: string): Promise<PlaybackDeviceStatus | null> {
    const adapter = this.bySourceId.get(sourceId)
    if (!adapter?.ensureConnected) {
      return null
    }
    try {
      await adapter.ensureConnected()
    } catch {
      return adapter.getDeviceStatus?.() ?? null
    }
    return adapter.getDeviceStatus?.() ?? null
  }

  async reconnectDevice(sourceId: string): Promise<PlaybackDeviceStatus | null> {
    const adapter = this.bySourceId.get(sourceId)
    if (!adapter?.reconnect) {
      return null
    }
    await adapter.reconnect()
    return adapter.getDeviceStatus?.() ?? null
  }

  /** Отключить Web Playback device (logout источника). */
  releaseDevice(sourceId: string): void {
    const adapter = this.bySourceId.get(sourceId)
    if (adapter === this.spotify) {
      this.spotify.disconnectSession()
    }
  }

  async load(url: string): Promise<void> {
    this.activateForUrl(url)
    await this.active.load(url)
  }

  async play(): Promise<void> {
    await this.active.play()
  }

  pause(): void {
    this.active.pause()
  }

  stop(): void {
    this.active.stop()
  }

  seek(timeSeconds: number): void {
    this.active.seek(timeSeconds)
  }

  setVolume(volume: number): void {
    this.active.setVolume(volume)
    // Синхронизируем громкость на оба бэкенда.
    if (this.active !== this.local) {
      this.local.setVolume(volume)
    }
    if (this.active !== this.spotify) {
      this.spotify.setVolume(volume)
    }
  }

  getCurrentTime(): number {
    return this.active.getCurrentTime()
  }

  getDuration(): number {
    return this.active.getDuration()
  }

  getVolume(): number {
    return this.active.getVolume()
  }

  subscribe(listener: (event: PlayerAdapterEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.unsubscribeActive?.()
    this.unsubscribeActive = null
    this.local.dispose()
    this.spotify.dispose()
    this.listeners.clear()
  }

  private bindActive(adapter: SourceBoundAdapter): void {
    this.unsubscribeActive?.()
    this.active = adapter
    this.unsubscribeActive = adapter.subscribe((event) => {
      for (const listener of this.listeners) {
        listener(event)
      }
    })
  }
}

let sharedManager: PlayerManager | null = null

export function getPlayerManager(): PlayerManager {
  if (!sharedManager) {
    sharedManager = new PlayerManager()
  }
  return sharedManager
}
