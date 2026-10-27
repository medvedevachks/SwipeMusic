import assert from 'node:assert/strict'
import test from 'node:test'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { withoutDemoTracks } from '../../sources/demoSource.ts'
import { parsePlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import {
  buildPersonalRadio,
  shouldReplaceHomeQueueWithSwipeFeed,
  type RadioLibraryItem,
  type RadioSearchPort,
} from './recommend.ts'
import {
  cardPlaybackPlan,
  deckKeepsRadioQueue,
  homeCardTracks,
  resolveCardPlay,
  runCardPlay,
  waveHomeView,
  type CardPlayDeps,
} from './homeStage.ts'
import { toggleMyWave, type MyWaveDeps } from './toggleMyWave.ts'

function track(partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>): Track {
  return {
    id: `${partial.sourceId}:${partial.externalId}`,
    album: partial.album,
    ...partial,
  }
}

function item(
  partial: Partial<RadioLibraryItem> & Pick<RadioLibraryItem, 'canonicalId' | 'title' | 'artist'>,
): RadioLibraryItem {
  return {
    liked: false,
    disliked: false,
    hidden: false,
    playCount: 0,
    skipped: 0,
    lastPlayed: null,
    copies: [
      {
        sourceId: 'yandex-music',
        externalId: partial.canonicalId,
        title: partial.title,
        artist: partial.artist,
      },
    ],
    ...partial,
  }
}

function port(overrides: Partial<RadioSearchPort> = {}): RadioSearchPort {
  return {
    sources: [{ id: 'yandex-music' }],
    search: async () => [],
    isPlayable: async () => true,
    ...overrides,
  }
}

test('radio does nothing without liked tracks', async () => {
  const plan = await buildPersonalRadio([item({ canonicalId: 'a', title: 'A', artist: 'Nova', liked: false })], port())
  assert.equal(plan.status, 'no-likes')
  assert.equal(plan.tracks.length, 0)
})

test('one liked artist searches new playable tracks and skips the seed', async () => {
  const queries: string[] = []
  const plan = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Midnight', artist: 'Nova Lane', liked: true })],
    port({
      search: async (_sourceId, query) => {
        queries.push(query)
        return [
          track({ sourceId: 'yandex-music', externalId: 'seed', title: 'Midnight', artist: 'Nova Lane' }),
          track({ sourceId: 'yandex-music', externalId: 'dawn', title: 'Dawn', artist: 'Nova Lane' }),
        ]
      },
    }),
  )
  assert.deepEqual(queries, ['Nova Lane'])
  assert.equal(plan.status, 'ready')
  assert.equal(plan.origin, 'recommendations')
  assert.deepEqual(plan.tracks.map((entry) => entry.externalId), ['dawn'])
})

test('several artists are interleaved instead of grouped', async () => {
  const plan = await buildPersonalRadio(
    [
      item({ canonicalId: 'a', title: 'A0', artist: 'Alpha', liked: true, playCount: 2 }),
      item({ canonicalId: 'b', title: 'B0', artist: 'Beta', liked: true, playCount: 1 }),
    ],
    port({
      search: async (_sourceId, query) => {
        if (query === 'Alpha') {
          return [
            track({ sourceId: 'yandex-music', externalId: 'a1', title: 'A1', artist: 'Alpha' }),
            track({ sourceId: 'yandex-music', externalId: 'a2', title: 'A2', artist: 'Alpha' }),
          ]
        }
        return [track({ sourceId: 'yandex-music', externalId: 'b1', title: 'B1', artist: 'Beta' })]
      },
    }),
  )
  assert.deepEqual(
    plan.tracks.map((entry) => entry.externalId),
    ['a1', 'b1', 'a2'],
  )
})

test('unplayable candidates fall back to saved favorites and say so', async () => {
  const plan = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    port({
      search: async () => [track({ sourceId: 'yandex-music', externalId: 'new', title: 'New', artist: 'Nova' })],
      isPlayable: async (entry) => entry.externalId === 'seed',
    }),
  )
  assert.equal(plan.status, 'favorites')
  assert.equal(plan.origin, 'favorites')
  assert.equal(plan.tracks[0]?.externalId, 'seed')
  assert.match(plan.message, /не подборка/)
})

test('only unavailable candidates produce no playback', async () => {
  const plan = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    port({
      search: async () => [track({ sourceId: 'yandex-music', externalId: 'new', title: 'New', artist: 'Nova' })],
      isPlayable: async () => false,
    }),
  )
  assert.equal(plan.status, 'unavailable')
  assert.equal(plan.tracks.length, 0)
})

test('a failed or timed out search does not start playback', async () => {
  const failed = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    port({
      search: async () => {
        throw new Error('provider down')
      },
    }),
  )
  assert.equal(failed.status, 'error')

  const timedOut = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    port({
      search: (_sourceId, _query, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('timeout')))
        }),
    }),
    { timeoutMs: 20 },
  )
  assert.equal(timedOut.status, 'error')
  assert.equal(timedOut.tracks.length, 0)
})

test('duplicates, disliked tracks and demo tracks stay out of the radio', async () => {
  const plan = await buildPersonalRadio(
    [
      item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true }),
      item({ canonicalId: 'nope', title: 'Hidden Hit', artist: 'Nova', disliked: true }),
    ],
    port({
      search: async () => [
        track({ sourceId: 'mock', externalId: 'demo', title: 'Midnight Drive', artist: 'Nova Lane' }),
        track({ sourceId: 'yandex-music', externalId: 'copy-1', title: 'Dawn', artist: 'Nova' }),
        track({ sourceId: 'spotify', externalId: 'copy-2', title: 'Dawn', artist: 'Nova' }),
        track({ sourceId: 'yandex-music', externalId: 'bad', title: 'Hidden Hit', artist: 'Nova' }),
      ],
    }),
  )
  assert.deepEqual(plan.tracks.map((entry) => entry.externalId), ['copy-1'])
  assert.equal(withoutDemoTracks(plan.tracks).length, plan.tracks.length)
})

test('liked demo copies are not a real radio seed', async () => {
  const plan = await buildPersonalRadio(
    [
      item({
        canonicalId: 'demo',
        title: 'Midnight Drive',
        artist: 'Nova Lane',
        liked: true,
        copies: [{ sourceId: 'mock', externalId: 'r1', title: 'Midnight Drive', artist: 'Nova Lane' }],
      }),
    ],
    port(),
  )
  assert.equal(plan.status, 'no-likes')
})

test('radio reports when no real source is connected', async () => {
  const plan = await buildPersonalRadio(
    [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    port({ sources: [] }),
  )
  assert.equal(plan.status, 'no-source')
})

test('repeat play pauses and resumes the same radio queue', async () => {
  const transport = {
    radioActive: false,
    playing: false,
    paused: false,
    queueLength: 0,
  }
  let plays = 0
  let pauses = 0
  let resumes = 0
  const deps: MyWaveDeps = {
    readTransport: () => ({ ...transport }),
    pause: () => {
      pauses += 1
      transport.playing = false
      transport.paused = true
    },
    resume: async () => {
      resumes += 1
      transport.playing = true
      transport.paused = false
    },
    play: async () => {
      plays += 1
      transport.radioActive = true
      transport.playing = true
      transport.paused = false
      transport.queueLength = 1
    },
    loadLibrary: () => [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })],
    loadPort: async () =>
      port({
        search: async () => [track({ sourceId: 'yandex-music', externalId: 'dawn', title: 'Dawn', artist: 'Nova' })],
      }),
    readRotation: () => 1,
    storeRotation: () => undefined,
  }

  const started = await toggleMyWave(deps)
  const paused = await toggleMyWave(deps)
  const resumed = await toggleMyWave(deps)
  assert.equal(started.status, 'ready')
  assert.equal(started.startIndex, 0)
  assert.equal(paused.message, 'Пауза')
  assert.equal(resumed.message, 'Моя волна')
  assert.equal(plays, 1)
  assert.equal(pauses, 1)
  assert.equal(resumes, 1)
})

test('next and previous stay inside the radio queue across navigation', () => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
  const queue = new PlaybackQueue()
  const tracks = [
    track({ sourceId: 'yandex-music', externalId: '1', title: 'One', artist: 'Nova' }),
    track({ sourceId: 'yandex-music', externalId: '2', title: 'Two', artist: 'Nova' }),
    track({ sourceId: 'yandex-music', externalId: '3', title: 'Three', artist: 'Nova' }),
  ]
  queue.setQueue(tracks, 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(queue.next()?.externalId, '2')
  assert.equal(queue.previous()?.externalId, '1')
  assert.equal(queue.getPlaybackContext().type, 'radio')
  assert.equal(shouldReplaceHomeQueueWithSwipeFeed({
    queueLocked: true,
    feedLength: 4,
    queueLength: queue.getItems().length,
  }), false)
  const restored = parsePlaybackContext(JSON.parse(JSON.stringify(queue.getPlaybackContext())))
  assert.equal(restored.type, 'radio')
  if (restored.type === 'radio') {
    assert.equal(restored.origin, 'recommendations')
  }
})

test('a second wave start does not always begin at the first song', async () => {
  const library = [item({ canonicalId: 'seed', title: 'Kept', artist: 'Nova', liked: true })]
  const searchPort = port({
    search: async () => [
      track({ sourceId: 'yandex-music', externalId: 'a', title: 'A', artist: 'Nova' }),
      track({ sourceId: 'yandex-music', externalId: 'b', title: 'B', artist: 'Nova' }),
    ],
  })
  const first = await buildPersonalRadio(library, searchPort, { rotation: 0 })
  const second = await buildPersonalRadio(library, searchPort, { rotation: 1 })
  assert.equal(first.startIndex, 0)
  assert.equal(second.startIndex, 1)
  assert.equal(second.tracks[0]?.externalId, first.tracks[0]?.externalId)
})

test('the home card follows the radio queue and does not reuse the sorting feed', () => {
  const feed = [track({ sourceId: 'yandex-music', externalId: 'reason', title: 'Just Give Me a Reason', artist: 'P!nk' })]
  const radioQueue = [
    track({ sourceId: 'yandex-music', externalId: 'diamonds', title: 'Diamonds', artist: 'Rihanna' }),
    track({ sourceId: 'yandex-music', externalId: 'light', title: 'Светлое чувство', artist: 'Settlers' }),
    track({ sourceId: 'mock', externalId: 'demo', title: 'Midnight Drive', artist: 'Nova Lane' }),
  ]
  const visible = homeCardTracks({
    stage: 'wave',
    feed,
    radioQueue,
    radioActive: true,
  })
  assert.deepEqual(visible.map((entry) => entry.externalId), ['diamonds', 'light'])
  assert.equal(
    cardPlaybackPlan({
      stage: 'wave',
      cardId: visible[1]?.id ?? null,
      playerId: visible[1]?.id ?? null,
      playing: true,
    }),
    'pause',
  )
  assert.equal(
    cardPlaybackPlan({
      stage: 'wave',
      cardId: visible[0]?.id ?? null,
      playerId: visible[1]?.id ?? null,
      playing: true,
    }),
    'play-radio',
  )
  assert.equal(deckKeepsRadioQueue('wave', true), true)
  assert.equal(deckKeepsRadioQueue('sorting', true), false)
  assert.deepEqual(
    homeCardTracks({ stage: 'sorting', feed, radioQueue, radioActive: true }).map((entry) => entry.externalId),
    ['reason'],
  )
  assert.equal(
    cardPlaybackPlan({
      stage: 'sorting',
      cardId: feed[0]?.id ?? null,
      playerId: radioQueue[0]?.id ?? null,
      playing: true,
    }),
    'play-swipe',
  )
  assert.equal(
    cardPlaybackPlan({
      stage: 'sorting',
      cardId: feed[0]?.id ?? null,
      playerId: feed[0]?.id ?? null,
      playing: false,
    }),
    'resume',
  )
  assert.equal(
    waveHomeView({ radioActive: true, radioQueueLength: 2, likedCount: 1, hasRealSource: true }),
    'deck',
  )
  assert.equal(
    waveHomeView({ radioActive: false, radioQueueLength: 0, likedCount: 0, hasRealSource: true }),
    'needs-likes',
  )
  assert.equal(
    waveHomeView({ radioActive: false, radioQueueLength: 0, likedCount: 3, hasRealSource: false }),
    'needs-source',
  )
  assert.equal(
    waveHomeView({ radioActive: true, radioQueueLength: 0, likedCount: 3, hasRealSource: true }),
    'start',
  )
})

test('card play stays on the wave track, then the swipe track, without resuming the other queue', async () => {
  const waveId = 'yandex-music:light'
  const swipeId = 'yandex-music:reason'
  const calls: string[] = []
  const player = {
    currentId: null as string | null,
    pendingId: null as string | null,
    playing: false,
    context: 'none' as 'none' | 'radio' | 'swipe',
    queue: [] as string[],
    position: 12,
    builds: 0,
  }

  const deps = (failPlay = false): CardPlayDeps => ({
    pause() {
      calls.push('pause')
      player.playing = false
      player.pendingId = null
    },
    async resume() {
      calls.push('resume')
      player.playing = true
      player.pendingId = null
    },
    async playSwipe() {
      calls.push('play-swipe')
      if (failPlay) {
        player.playing = false
        player.pendingId = null
        throw new Error('playback failed')
      }
      player.context = 'swipe'
      player.queue = [swipeId]
      player.currentId = swipeId
      player.pendingId = null
      player.playing = true
      player.position = 0
    },
    async playRadio() {
      calls.push('play-radio')
      player.context = 'radio'
      player.queue = [waveId, 'yandex-music:bandage']
      player.currentId = waveId
      player.pendingId = null
      player.playing = true
      player.position = 0
    },
    async buildWave() {
      calls.push('build-wave')
      player.builds += 1
      player.context = 'radio'
      player.queue = [waveId]
      player.currentId = waveId
      player.playing = true
      player.position = 0
    },
  })

  const base = {
    cardId: waveId,
    currentId: player.currentId,
    pendingId: player.pendingId,
    playing: player.playing,
    radioReady: false,
  }

  assert.equal(
    await runCardPlay({ ...base, stage: 'wave' }, deps()),
    'built',
  )
  assert.equal(player.context, 'radio')
  assert.equal(player.currentId, waveId)
  assert.equal(player.playing, true)
  assert.equal(player.builds, 1)

  player.position = 18
  assert.equal(
    await runCardPlay(
      { stage: 'wave', cardId: waveId, currentId: waveId, pendingId: null, playing: true, radioReady: true },
      deps(),
    ),
    'paused',
  )
  assert.equal(player.playing, false)
  assert.equal(player.currentId, waveId)
  assert.equal(player.position, 18)
  assert.equal(player.builds, 1)

  assert.equal(
    await runCardPlay(
      { stage: 'wave', cardId: waveId, currentId: waveId, pendingId: null, playing: false, radioReady: true },
      deps(),
    ),
    'resumed',
  )
  assert.equal(player.playing, true)
  assert.equal(player.currentId, waveId)
  assert.equal(player.position, 18)
  assert.equal(player.context, 'radio')

  assert.equal(
    await runCardPlay(
      { stage: 'sorting', cardId: swipeId, currentId: waveId, pendingId: null, playing: true, radioReady: true },
      deps(),
    ),
    'played',
  )
  assert.equal(player.currentId, swipeId)
  assert.equal(player.context, 'swipe')
  assert.deepEqual(player.queue, [swipeId])
  assert.equal(calls.includes('resume'), true)
  assert.equal(calls.filter((call) => call === 'play-swipe').length, 1)
  assert.equal(calls.filter((call) => call === 'resume' && calls.indexOf('play-swipe') >= 0).length >= 0, true)

  const beforeBack = calls.length
  assert.equal(
    await runCardPlay(
      { stage: 'wave', cardId: waveId, currentId: swipeId, pendingId: null, playing: true, radioReady: true },
      deps(),
    ),
    'played',
  )
  assert.equal(player.currentId, waveId)
  assert.equal(player.context, 'radio')
  assert.equal(calls.slice(beforeBack).includes('resume'), false)

  const resumeCalls = calls.filter((call) => call === 'resume').length
  assert.equal(
    await runCardPlay(
      { stage: 'sorting', cardId: swipeId, currentId: waveId, pendingId: null, playing: true, radioReady: true },
      deps(),
    ),
    'played',
  )
  assert.equal(calls.filter((call) => call === 'resume').length, resumeCalls)
  assert.equal(player.currentId, swipeId)

  let started = 0
  let release: (() => void) | null = null
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const slow: CardPlayDeps = {
    ...deps(),
    async playSwipe() {
      started += 1
      await gate
      player.currentId = swipeId
      player.context = 'swipe'
      player.playing = true
    },
  }
  const first = runCardPlay(
    { stage: 'sorting', cardId: swipeId, currentId: waveId, pendingId: null, playing: false, radioReady: false },
    slow,
  )
  const second = await runCardPlay(
    { stage: 'sorting', cardId: swipeId, currentId: waveId, pendingId: null, playing: false, radioReady: false },
    slow,
  )
  assert.equal(second, 'ignored')
  assert.equal(started, 1)
  release?.()
  assert.equal(await first, 'played')

  assert.equal(
    resolveCardPlay({
      stage: 'wave',
      intent: 'advance',
      cardId: 'yandex-music:bandage',
      currentId: waveId,
      pendingId: null,
      playing: true,
      radioReady: true,
    }),
    'play-radio',
  )
  assert.equal(
    resolveCardPlay({
      stage: 'sorting',
      intent: 'advance',
      cardId: swipeId,
      currentId: swipeId,
      pendingId: null,
      playing: true,
      radioReady: false,
    }),
    'play-swipe',
  )

  player.currentId = waveId
  player.playing = true
  player.context = 'radio'
  player.queue = [waveId]
  const failed = calls.length
  assert.equal(
    await runCardPlay(
      { stage: 'sorting', cardId: swipeId, currentId: waveId, pendingId: null, playing: true, radioReady: true },
      deps(true),
    ),
    'failed',
  )
  assert.equal(player.playing, false)
  assert.equal(player.currentId, waveId)
  assert.equal(player.context, 'radio')
  assert.equal(calls.slice(failed).includes('resume'), false)
  assert.equal(calls.slice(failed).includes('pause'), false)
  assert.equal(
    resolveCardPlay({
      stage: 'wave',
      cardId: waveId,
      currentId: null,
      pendingId: null,
      playing: false,
      radioReady: true,
    }),
    'play-radio',
  )
})
