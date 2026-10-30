/**
 * Контролируемый PlayerAdapter для интеграционных тестов session-switch.
 * Поддерживает dual-backend (local / spotify:) без реального HTMLAudio / SDK.
 */
import type {
  PlayerAdapter,
  PlayerAdapterEvent,
  PlayerAdapterEventType,
} from '../../audioPlayer/PlayerAdapter.ts'

export type ControllableBackend = {
  id: string
  url: string | null
  playing: boolean
  currentTime: number
  duration: number
  loadDelayMs: number
  playDelayMs: number
  failNextLoad: boolean
  failNextPlay: boolean | 'NotAllowedError'
  loadCount: number
  playCount: number
  pauseCount: number
}

function createBackend(id: string): ControllableBackend {
  return {
    id,
    url: null,
    playing: false,
    currentTime: 0,
    duration: 180,
    loadDelayMs: 0,
    playDelayMs: 0,
    failNextLoad: false,
    failNextPlay: false,
    loadCount: 0,
    playCount: 0,
    pauseCount: 0,
  }
}

export type ControllablePlayerAdapter = PlayerAdapter & {
  readonly local: ControllableBackend
  readonly spotify: ControllableBackend
  getActiveBackend(): ControllableBackend
  /** true если оба бэкенда одновременно playing — запрещено. */
  hadDualPlayback(): boolean
  setLoadDelay(ms: number): void
  setPlayDelay(ms: number): void
  failNextLoad(): void
  failNextPlay(kind?: boolean | 'NotAllowedError'): void
}

/**
 * Маршрутизация как у PlayerManager: spotify: → spotify backend, иначе local.
 * На load сначала pause обоих бэкендов (семантика PlayerManager.pauseBackends).
 */
export function createControllablePlayerAdapter(): ControllablePlayerAdapter {
  const local = createBackend('local')
  const spotify = createBackend('spotify')
  let active = local
  let volume = 1
  let muted = false
  let rate = 1
  let dualPlayback = false
  /** Как PlayerManager.loadGeneration — отменяет устаревший in-flight load. */
  let loadGeneration = 0
  const listeners = new Set<(event: PlayerAdapterEvent) => void>()

  let defaultLoadDelay = 0
  let defaultPlayDelay = 0
  let failLoad = false
  let failPlay: boolean | 'NotAllowedError' = false

  function emit(type: PlayerAdapterEventType, error?: string): void {
    const event: PlayerAdapterEvent = {
      type,
      currentTime: active.currentTime,
      duration: active.duration,
      volume,
      muted,
      playbackRate: rate,
      error,
    }
    for (const listener of listeners) {
      listener(event)
    }
  }

  function selectForUrl(url: string): ControllableBackend {
    return url.startsWith('spotify:') ? spotify : local
  }

  function noteDual(): void {
    if (local.playing && spotify.playing) {
      dualPlayback = true
    }
  }

  const adapter: ControllablePlayerAdapter = {
    local,
    spotify,
    getActiveBackend: () => active,
    hadDualPlayback: () => dualPlayback,
    setLoadDelay(ms) {
      defaultLoadDelay = ms
    },
    setPlayDelay(ms) {
      defaultPlayDelay = ms
    },
    failNextLoad() {
      failLoad = true
    },
    failNextPlay(kind = true) {
      failPlay = kind
    },
    async load(url: string): Promise<void> {
      const generation = ++loadGeneration
      // Как PlayerManager.load: сначала pause backends
      local.playing = false
      spotify.playing = false
      local.pauseCount += 1
      spotify.pauseCount += 1

      const next = selectForUrl(url)
      const delay = next.loadDelayMs || defaultLoadDelay
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
      }
      if (generation !== loadGeneration) {
        const err = new Error('controllable load aborted')
        err.name = 'AbortError'
        throw err
      }
      active = next
      next.loadCount += 1
      if (failLoad || next.failNextLoad) {
        failLoad = false
        next.failNextLoad = false
        const err = new Error('controllable load failed')
        emit('error', err.message)
        throw err
      }
      next.url = url
      next.currentTime = 0
      emit('loadstart')
      emit('loadedmetadata')
      emit('canplay')
    },
    async play(): Promise<void> {
      const delay = active.playDelayMs || defaultPlayDelay
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
      }
      active.playCount += 1
      const fail = failPlay || active.failNextPlay
      if (fail) {
        failPlay = false
        active.failNextPlay = false
        if (fail === 'NotAllowedError') {
          const err = new Error('play() failed because the user did not interact')
          err.name = 'NotAllowedError'
          throw err
        }
        throw new Error('controllable play failed')
      }
      active.playing = true
      noteDual()
      emit('play')
    },
    pause(): void {
      loadGeneration += 1
      active.playing = false
      active.pauseCount += 1
      emit('pause')
    },
    stop(): void {
      loadGeneration += 1
      active.playing = false
      active.currentTime = 0
      emit('stop')
    },
    seek(timeSeconds: number): void {
      active.currentTime = timeSeconds
      emit('timeupdate')
    },
    setVolume(v: number): void {
      volume = v
      emit('volumechange')
    },
    setMuted(m: boolean): void {
      muted = m
      emit('volumechange')
    },
    setPlaybackRate(r: number): void {
      rate = r
      emit('ratechange')
    },
    getCurrentTime: () => active.currentTime,
    getDuration: () => active.duration,
    getVolume: () => volume,
    getMuted: () => muted,
    getPlaybackRate: () => rate,
    isPlaying: () => active.playing,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose(): void {
      listeners.clear()
      local.playing = false
      spotify.playing = false
    },
  }

  return adapter
}
