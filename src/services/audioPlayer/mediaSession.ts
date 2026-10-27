import type { PlayerState } from '../../types/player.ts'
import type { Track } from '../../types/track.ts'
import { useAuthStore } from '../../store/authStore.ts'
import { pushDevMediaSessionLog } from './devMediaSessionLog.ts'

/** Команды, которые Android может прислать в установленное PWA. */
export const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'nexttrack',
  'previoustrack',
  'stop',
] as const

export type MediaSessionActionName = (typeof MEDIA_SESSION_ACTIONS)[number]

export type MediaSessionPlaybackState = 'none' | 'paused' | 'playing'

export type MediaSessionArtwork = {
  src: string
  sizes: string
  type: string
}

export type MediaSessionMetadata = {
  title: string
  artist: string
  album: string
  artwork?: MediaSessionArtwork[]
}

export type MediaSessionPosition = {
  duration: number
  position: number
  playbackRate: number
}

export type MediaSessionPort = {
  setMetadata: (metadata: MediaSessionMetadata | null) => void
  setPlaybackState: (state: MediaSessionPlaybackState) => void
  setPositionState: (state: MediaSessionPosition | null) => void
  setActionHandler: (
    action: MediaSessionActionName,
    handler: (() => void) | null,
  ) => boolean
}

export type MediaSessionPlayer = {
  getState: () => PlayerState
  pause: () => void
  resume: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  stop: () => void
  subscribe: (listener: (state: PlayerState) => void) => () => void
}

export type MediaSessionStatus = {
  supported: boolean
  actions: readonly MediaSessionActionName[]
  playbackState: MediaSessionPlaybackState
  title: string | null
  artist: string | null
}

const AUDIO_PATH = /\.(mp3|flac|m4a|aac|ogg|wav|opus|m3u8)(?:$|\?)/i
const STREAM_HINT = /get-mp3|\/file\/|audiostream|signed|token=|sign=|x-amz-|signature=|expires=/i
const SECRET_QUERY = /token|sign|signature|expires|auth|key/i

let status: MediaSessionStatus = {
  supported: false,
  actions: [],
  playbackState: 'none',
  title: null,
  artist: null,
}

const attachedPlayers = new WeakSet<object>()

export function getMediaSessionStatus(): MediaSessionStatus {
  return status
}

/** Обложка для системы. Поток, preview и подписанный URL сюда не попадают. */
export function artworkForMediaSession(
  coverUrl: string | null | undefined,
): MediaSessionArtwork[] | undefined {
  if (!coverUrl) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(coverUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined
  }
  if (AUDIO_PATH.test(url.pathname) || STREAM_HINT.test(coverUrl) || SECRET_QUERY.test(url.search)) {
    return undefined
  }
  const sizes = /\/(\d+x\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? '512x512'
  return [{ src: `${url.origin}${url.pathname}`, sizes, type: 'image/jpeg' }]
}

export function metadataForMediaSession(track: Track | null): MediaSessionMetadata | null {
  if (!track) {
    return null
  }
  const title = track.title.trim()
  const artist = track.artist.trim()
  if (!title && !artist) {
    return null
  }
  const artwork = artworkForMediaSession(track.coverUrl)
  return {
    title: title || 'Без названия',
    artist,
    album: track.album?.trim() ?? '',
    ...(artwork ? { artwork } : {}),
  }
}

export function playbackStateForMediaSession(input: {
  anonymous: boolean
  track: Track | null
  playing: boolean
}): MediaSessionPlaybackState {
  if (input.anonymous || !input.track) {
    return 'none'
  }
  return input.playing ? 'playing' : 'paused'
}

export function positionForMediaSession(state: PlayerState): MediaSessionPosition | null {
  const duration = state.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    return null
  }
  const position = Math.min(Math.max(0, state.currentTime), duration)
  if (!Number.isFinite(position)) {
    return null
  }
  const playbackRate = state.playing ? state.playbackRate || 1 : 0
  return { duration, position, playbackRate }
}

function browserPort(): MediaSessionPort | null {
  if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof MediaMetadata === 'undefined') {
    return null
  }
  const session = navigator.mediaSession
  return {
    setMetadata(metadata) {
      const assign = (artwork: MediaSessionArtwork[] | undefined) => {
        session.metadata = metadata
          ? new MediaMetadata({
              title: metadata.title,
              artist: metadata.artist,
              album: metadata.album,
              artwork,
            })
          : null
      }
      try {
        assign(metadata?.artwork)
      } catch {
        try {
          assign(undefined)
        } catch {
          session.metadata = null
        }
      }
    },
    setPlaybackState(state) {
      session.playbackState = state
    },
    setPositionState(next) {
      if (typeof session.setPositionState !== 'function') {
        return
      }
      try {
        if (!next) {
          session.setPositionState()
          return
        }
        session.setPositionState(next)
      } catch {
        // Некорректная позиция не должна останавливать плеер.
      }
    },
    setActionHandler(action, handler) {
      try {
        session.setActionHandler(action, handler)
        return true
      } catch {
        return false
      }
    },
  }
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : 'failed'
  if (/https?:|token|sign|signature/i.test(message)) {
    return 'failed'
  }
  return message.slice(0, 120) || 'failed'
}

/**
 * Единственная регистрация системных медиакоманд на существующий AudioPlayer.
 * Повторный вызов для того же плеера ничего не добавляет.
 */
export function attachMediaSession(
  player: MediaSessionPlayer,
  options?: {
    port?: MediaSessionPort | null
    isAnonymous?: () => boolean
    watchAuth?: (listener: (anonymous: boolean) => void) => () => void
    record?: (message: string, detail?: string) => void
  },
): () => void {
  if (attachedPlayers.has(player)) {
    return () => {}
  }
  attachedPlayers.add(player)

  const port = options && 'port' in options ? options.port ?? null : browserPort()
  const isAnonymous = options?.isAnonymous ?? (() => useAuthStore.getState().status === 'anonymous')
  const record = options?.record ?? ((message: string, detail?: string) => {
    pushDevMediaSessionLog({ message, detail })
  })
  const watchAuth = options?.watchAuth ?? ((listener: (anonymous: boolean) => void) =>
    useAuthStore.subscribe((state, previous) => {
      if (state.status === previous.status) {
        return
      }
      listener(state.status === 'anonymous')
    }))

  const registered: MediaSessionActionName[] = []
  const pending = new Set<MediaSessionActionName>()
  let lastPublishKey = ''
  let lastPositionAt = 0
  let publishDepth = 0
  let publishAgain = false
  /** Команда, которую браузер вызвал синхронно из setPlaybackState/setMetadata. */
  let publishing = 0

  const publish = (state: PlayerState, positionNow = false) => {
    if (!port) {
      return
    }
    if (publishDepth > 0) {
      publishAgain = true
      return
    }
    publishDepth += 1
    try {
      writeSession(state, positionNow)
    } finally {
      publishDepth -= 1
    }
    if (publishAgain) {
      publishAgain = false
      publishDepth += 1
      try {
        writeSession(player.getState(), true)
      } finally {
        publishDepth -= 1
      }
    }
  }

  const writeSession = (state: PlayerState, positionNow = false) => {
    if (!port) {
      return
    }
    const anonymous = isAnonymous()
    const track = anonymous ? null : state.pendingTrack ?? state.currentTrack
    const playbackState = playbackStateForMediaSession({
      anonymous,
      track,
      playing: state.playing,
    })
    const metadata = metadataForMediaSession(track)
    const key = [
      playbackState,
      metadata?.title ?? '',
      metadata?.artist ?? '',
      metadata?.album ?? '',
      metadata?.artwork?.[0]?.src ?? '',
    ].join('|')
    const changed = key !== lastPublishKey
    if (changed) {
      callPort(() => {
        port.setPlaybackState(playbackState)
        port.setMetadata(metadata)
      })
      lastPublishKey = key
      status = {
        supported: true,
        actions: [...registered],
        playbackState,
        title: metadata?.title ?? null,
        artist: metadata?.artist ?? null,
      }
      record(
        'state',
        playbackState === 'none'
          ? 'none'
          : `${playbackState} · ${metadata?.title ?? ''} — ${metadata?.artist ?? ''}`,
      )
    }
    const now = Date.now()
    if (positionNow || changed || now - lastPositionAt >= 1000) {
      lastPositionAt = now
      callPort(() => {
        port.setPositionState(anonymous ? null : positionForMediaSession(state))
      })
    }
  }

  const callPort = (write: () => void) => {
    publishing += 1
    try {
      write()
    } finally {
      publishing -= 1
    }
  }

  const run = (action: MediaSessionActionName, effect: () => void | Promise<void>) => {
    if (publishing > 0) {
      record(action, 'ignored-echo')
      return
    }
    if (isAnonymous()) {
      record(action, 'ignored-logged-out')
      return
    }
    if (pending.has(action)) {
      record(action, 'ignored-duplicate')
      return
    }
    pending.add(action)
    record(action, 'received')
    void Promise.resolve()
      .then(effect)
      .then(() => {
        record(action, 'ok')
      })
      .catch((error: unknown) => {
        record(action, safeFailure(error))
      })
      .finally(() => {
        pending.delete(action)
      })
  }

  if (!port) {
    status = {
      supported: false,
      actions: [],
      playbackState: 'none',
      title: null,
      artist: null,
    }
    record('availability', 'Media Session API недоступен')
    attachedPlayers.delete(player)
    return () => {}
  }

  const handlers: Record<MediaSessionActionName, () => void> = {
    play: () => {
      run('play', async () => {
        if (player.getState().playing) {
          record('play', 'already-playing')
          return
        }
        record('play', 'player.resume')
        await player.resume()
      })
    },
    pause: () => {
      run('pause', () => {
        if (!player.getState().playing) {
          record('pause', 'already-paused')
          return
        }
        record('pause', 'player.pause')
        player.pause()
      })
    },
    nexttrack: () => {
      run('nexttrack', async () => {
        record('nexttrack', 'player.next')
        await player.next()
      })
    },
    previoustrack: () => {
      run('previoustrack', async () => {
        record('previoustrack', 'player.previous')
        await player.previous()
      })
    },
    stop: () => {
      run('stop', () => {
        const state = player.getState()
        if (!state.playing && !state.currentTrack && !state.pendingTrack) {
          record('stop', 'idle')
          return
        }
        record('stop', 'player.stop')
        player.stop()
      })
    },
  }

  for (const action of MEDIA_SESSION_ACTIONS) {
    if (port.setActionHandler(action, handlers[action])) {
      registered.push(action)
    }
  }

  status = {
    supported: true,
    actions: [...registered],
    playbackState: 'none',
    title: null,
    artist: null,
  }
  record('availability', `registered: ${registered.join(', ') || 'none'}`)

  const unsubscribePlayer = player.subscribe((state) => {
    publish(state)
  })
  publish(player.getState(), true)

  const unsubscribeAuth = watchAuth((anonymous) => {
    if (!anonymous) {
      publish(player.getState(), true)
      return
    }
    if (player.getState().playing) {
      player.pause()
    }
    publish(player.getState(), true)
  })

  return () => {
    unsubscribePlayer()
    unsubscribeAuth()
    for (const action of registered) {
      port.setActionHandler(action, null)
    }
    attachedPlayers.delete(player)
  }
}
