import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { initialPlayerState, type PlayerState } from '../../types/player.ts'
import type { Track } from '../../types/track.ts'
import {
  artworkForMediaSession,
  attachMediaSession,
  MEDIA_SESSION_ACTIONS,
  metadataForMediaSession,
  playbackStateForMediaSession,
  positionForMediaSession,
  type MediaSessionActionName,
  type MediaSessionMetadata,
  type MediaSessionPlaybackState,
  type MediaSessionPlayer,
  type MediaSessionPort,
  type MediaSessionPosition,
} from './mediaSession.ts'

function track(partial: Partial<Track> = {}): Track {
  return {
    id: 'yandex-music:1',
    sourceId: 'yandex-music',
    externalId: '1',
    title: 'Зверь',
    artist: 'Green Apelsin',
    album: 'Альбом',
    coverUrl: 'https://avatars.yandex.net/get-music-content/cover/200x200',
    previewUrl: 'https://storage.example/get-mp3/file?sign=secret-token',
    ...partial,
  }
}

function state(partial: Partial<PlayerState> = {}): PlayerState {
  return {
    ...initialPlayerState,
    currentTrack: track(),
    playing: true,
    paused: false,
    currentTime: 12,
    duration: 180,
    ...partial,
  }
}

function createPlayer(initial: PlayerState) {
  let current = initial
  const calls: string[] = []
  const listeners = new Set<(next: PlayerState) => void>()
  let nextGate: Promise<void> = Promise.resolve()
  const player: MediaSessionPlayer = {
    getState: () => current,
    pause() {
      calls.push('pause')
      current = { ...current, playing: false, paused: true }
    },
    async resume() {
      calls.push('resume')
      current = { ...current, playing: true, paused: false }
    },
    async next() {
      calls.push('next')
      await nextGate
    },
    async previous() {
      calls.push('previous')
    },
    stop() {
      calls.push('stop')
      current = { ...current, playing: false, paused: true, currentTime: 0 }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    player,
    calls,
    setState(next: PlayerState) {
      current = next
      for (const listener of listeners) {
        listener(current)
      }
    },
    holdNext() {
      let release: () => void = () => {}
      nextGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
  }
}

function createPort() {
  const handlers = new Map<MediaSessionActionName, (() => void) | null>()
  const metadata: Array<MediaSessionMetadata | null> = []
  const playback: MediaSessionPlaybackState[] = []
  const positions: Array<MediaSessionPosition | null> = []
  const rejected = new Set<MediaSessionActionName>()
  const port: MediaSessionPort = {
    setMetadata(next) {
      metadata.push(next)
    },
    setPlaybackState(next) {
      playback.push(next)
    },
    setPositionState(next) {
      positions.push(next)
    },
    setActionHandler(action, handler) {
      if (rejected.has(action)) {
        return false
      }
      handlers.set(action, handler)
      return true
    },
  }
  return { port, handlers, metadata, playback, positions, rejected }
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('media session metadata keeps the cover and drops the stream url', () => {
  const source = readFileSync(new URL('./mediaSession.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('previewUrl'), false)
  assert.equal(source.includes('activeCandidate'), false)
  assert.equal(source.includes('playSearchSeedAdvance'), false)
  assert.equal(source.includes('currentTime > 3'), false)
  assert.match(source, /player\.next/)
  assert.match(source, /player\.previous/)

  const signed = track()
  const metadata = metadataForMediaSession(signed)
  assert.equal(metadata?.title, 'Зверь')
  assert.equal(metadata?.artist, 'Green Apelsin')
  assert.equal(metadata?.album, 'Альбом')
  assert.equal(
    metadata?.artwork?.[0]?.src,
    'https://avatars.yandex.net/get-music-content/cover/200x200',
  )
  assert.equal(JSON.stringify(metadata).includes('secret-token'), false)
  assert.equal(JSON.stringify(metadata).includes('get-mp3'), false)

  assert.equal(artworkForMediaSession(signed.previewUrl), undefined)
  assert.equal(artworkForMediaSession('blob:track'), undefined)
  assert.equal(artworkForMediaSession('https://cdn.example/song.mp3?sign=1'), undefined)
  assert.equal(artworkForMediaSession('https://cdn.example/cover.jpg?token=abc'), undefined)
  assert.equal(metadataForMediaSession(null), null)
})

test('system commands call the existing player and a duplicate next is ignored', async () => {
  const fixture = createPlayer(state())
  const release = fixture.holdNext()
  const session = createPort()
  const log: string[] = []
  attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      log.push(detail ? `${message}:${detail}` : message)
    },
  })
  await flush()

  assert.deepEqual([...session.handlers.keys()], [...MEDIA_SESSION_ACTIONS])
  session.handlers.get('nexttrack')?.()
  session.handlers.get('nexttrack')?.()
  await flush()
  assert.deepEqual(fixture.calls, ['next'])
  assert.equal(log.includes('nexttrack:ignored-duplicate'), true)
  release()
  await flush()

  session.handlers.get('previoustrack')?.()
  session.handlers.get('pause')?.()
  await flush()
  assert.deepEqual(fixture.calls, ['next', 'previous', 'pause'])
  assert.equal(log.includes('previoustrack:player.previous'), true)
  assert.equal(log.includes('pause:player.pause'), true)
})

test('play resumes a paused track and does not resume when it is already playing', async () => {
  const playing = createPlayer(state({ playing: true }))
  const session = createPort()
  const log: string[] = []
  attachMediaSession(playing.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      log.push(`${message}:${detail ?? ''}`)
    },
  })
  await flush()
  session.handlers.get('play')?.()
  await flush()
  assert.deepEqual(playing.calls, [])
  assert.equal(log.includes('play:already-playing'), true)

  const paused = createPlayer(state({ playing: false, paused: true }))
  const pausedSession = createPort()
  attachMediaSession(paused.player, {
    port: pausedSession.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: () => {},
  })
  await flush()
  pausedSession.handlers.get('play')?.()
  await flush()
  assert.deepEqual(paused.calls, ['resume'])
})

test('publishing the same track does not loop and a later pause still pauses', async () => {
  const fixture = createPlayer(state({ playing: true }))
  const session = createPort()
  attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: () => {},
  })
  const published = session.playback.length
  for (let index = 0; index < 5; index += 1) {
    fixture.setState(state({ playing: true, currentTime: 12 + index }))
  }
  assert.equal(session.playback.length, published)
  assert.equal(session.metadata.length, 1)
  session.handlers.get('pause')?.()
  await flush()
  assert.deepEqual(fixture.calls, ['pause'])
})

test('a real pause immediately after play is not treated as an echo', async () => {
  const fixture = createPlayer(state({ playing: false, paused: true }))
  const session = createPort()
  const log: string[] = []
  fixture.player.resume = async () => {
    fixture.calls.push('resume')
    fixture.setState(state({ playing: true, paused: false, currentTime: 0 }))
    session.handlers.get('pause')?.()
  }
  attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      log.push(`${message}:${detail ?? ''}`)
    },
  })
  await flush()
  session.handlers.get('play')?.()
  await flush()
  assert.equal(log.includes('pause:player.pause'), true)
  assert.equal(log.includes('pause:ignored-echo'), false)
  assert.deepEqual(fixture.calls, ['resume', 'pause'])
})

test('two finished next commands both advance and a failed next does not stick', async () => {
  const fixture = createPlayer(state())
  let failures = 0
  fixture.player.next = async () => {
    fixture.calls.push('next')
    if (fixture.calls.filter((call) => call === 'next').length === 2) {
      failures += 1
      throw new Error('https://storage.example/get-mp3/file?sign=secret')
    }
  }
  const session = createPort()
  const log: string[] = []
  attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      log.push(`${message}:${detail ?? ''}`)
    },
  })
  await flush()
  session.handlers.get('nexttrack')?.()
  await flush()
  session.handlers.get('nexttrack')?.()
  await flush()
  session.handlers.get('nexttrack')?.()
  await flush()
  assert.deepEqual(fixture.calls, ['next', 'next', 'next'])
  assert.equal(failures, 1)
  assert.equal(log.includes('nexttrack:failed'), true)
  assert.equal(log.some((line) => line.includes('secret')), false)
})

test('screen and system controls share the player methods for every queue', () => {
  const session = readFileSync(new URL('./mediaSession.ts', import.meta.url), 'utf8')
  const player = readFileSync(new URL('../../store/playerStore.ts', import.meta.url), 'utf8')
  const chrome = readFileSync(new URL('../../components/player/BottomPlayer.tsx', import.meta.url), 'utf8')
  assert.match(session, /await player\.next\(\)/)
  assert.match(session, /await player\.previous\(\)/)
  assert.match(session, /player\.pause\(\)/)
  assert.match(session, /await player\.resume\(\)/)
  assert.match(player, /pause: \(\) => audioPlayer\.pause\(\)/)
  assert.match(player, /resume: \(\) => audioPlayer\.resume\(\)/)
  assert.match(player, /next: \(\) => audioPlayer\.next\(\)/)
  assert.match(player, /previous: \(\) => audioPlayer\.previous\(\)/)
  assert.match(chrome, /pause\(\)/)
  assert.match(chrome, /resume\(\)/)
  assert.match(chrome, /void next\(\)/)
  assert.match(chrome, /void previous\(\)/)
  assert.equal(session.includes('search-seed'), false)
  assert.equal(session.includes('my-wave'), false)
})

test('a command echoed while publishing state does not toggle the player', async () => {
  const fixture = createPlayer(state({ playing: false, paused: true }))
  const calls: string[] = []
  let playHandler: (() => void) | null = null
  const port: MediaSessionPort = {
    setMetadata() {},
    setPlaybackState() {
      playHandler?.()
    },
    setPositionState() {},
    setActionHandler(action, handler) {
      if (action === 'play') {
        playHandler = handler
      }
      return true
    },
  }
  attachMediaSession(fixture.player, {
    port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      calls.push(`${message}:${detail ?? ''}`)
    },
  })
  assert.equal(calls.includes('play:ignored-echo'), true)
  assert.deepEqual(fixture.calls, [])
  await flush()
})

test('logout clears the system track and pauses only audible playback', () => {
  const fixture = createPlayer(state({ playing: true }))
  const session = createPort()
  let anonymous = false
  const watchers = new Set<(anonymous: boolean) => void>()
  attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => anonymous,
    watchAuth: (listener) => {
      watchers.add(listener)
      return () => {
        watchers.delete(listener)
      }
    },
    record: () => {},
  })
  assert.equal(session.playback.at(-1), 'playing')
  assert.equal(session.metadata.at(-1)?.title, 'Зверь')
  assert.equal(session.positions.at(-1)?.position, 12)

  anonymous = true
  for (const listener of watchers) {
    listener(true)
  }
  assert.deepEqual(fixture.calls, ['pause'])
  assert.equal(session.playback.at(-1), 'none')
  assert.equal(session.metadata.at(-1), null)
  assert.equal(session.positions.at(-1), null)

  const silent = createPlayer(state({ playing: false, paused: true }))
  const silentSession = createPort()
  let silentAnonymous = false
  const silentWatchers = new Set<(anonymous: boolean) => void>()
  attachMediaSession(silent.player, {
    port: silentSession.port,
    isAnonymous: () => silentAnonymous,
    watchAuth: (listener) => {
      silentWatchers.add(listener)
      return () => {}
    },
    record: () => {},
  })
  silentAnonymous = true
  for (const listener of silentWatchers) {
    listener(true)
  }
  assert.deepEqual(silent.calls, [])
  assert.equal(silentSession.playback.at(-1), 'none')
})

test('queue end and a missing media session leave the screen player usable', async () => {
  assert.equal(playbackStateForMediaSession({
    anonymous: false,
    track: null,
    playing: false,
  }), 'none')
  assert.equal(positionForMediaSession(state({ duration: 0, currentTime: 4 })), null)

  const fixture = createPlayer(state())
  const log: string[] = []
  attachMediaSession(fixture.player, {
    port: null,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: (message, detail) => {
      log.push(`${message}:${detail ?? ''}`)
    },
  })
  assert.equal(log.some((line) => line.includes('недоступен')), true)
  await fixture.player.next()
  sessionHandlersAbsent(fixture.calls)
  assert.deepEqual(fixture.calls, ['next'])

  const ended = createPlayer(state())
  const session = createPort()
  attachMediaSession(ended.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: () => {},
  })
  ended.setState(state({
    currentTrack: null,
    pendingTrack: null,
    playing: false,
    paused: true,
    currentTime: 0,
    duration: 0,
  }))
  assert.equal(session.playback.at(-1), 'none')
  assert.equal(session.metadata.at(-1), null)
})

test('an unsupported stop action does not block the other commands', () => {
  const fixture = createPlayer(state())
  const session = createPort()
  session.rejected.add('stop')
  const detach = attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: () => {},
  })
  assert.equal(session.handlers.has('stop'), false)
  assert.equal(session.handlers.has('nexttrack'), true)
  const again = attachMediaSession(fixture.player, {
    port: session.port,
    isAnonymous: () => false,
    watchAuth: () => () => {},
    record: () => {},
  })
  assert.equal(session.handlers.get('nexttrack') !== undefined, true)
  assert.equal([...session.handlers.keys()].filter((name) => name === 'nexttrack').length, 1)
  again()
  detach()
  assert.equal(session.handlers.get('play'), null)
})

function sessionHandlersAbsent(calls: string[]): void {
  assert.equal(calls.includes('pause'), false)
}
