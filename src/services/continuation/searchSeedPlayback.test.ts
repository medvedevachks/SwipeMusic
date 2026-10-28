import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  isQueueLockedContext,
  isSearchSeedContext,
  parsePlaybackContext,
} from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import { shouldReplaceHomeQueueWithSwipeFeed } from '../personalRadio/recommend.ts'
import {
  ContinuationSession,
  type ContinuationProvider,
} from './ContinuationSession.ts'
import {
  commitSearchSeedQueue,
  consumeSearchSeedAdvance,
  isSearchSeedPlaybackEnabled,
  planSearchPlayback,
  resolveSearchSeedPlaybackEnabled,
  searchDeckUsesSeedPlayback,
  setSearchSeedPlaybackEnabled,
  continuationPlaybackCaption,
  sortingDeckFollowsPlayer,
} from './searchSeedPlayback.ts'
import { isContinuationCandidateAvailable } from './types.ts'

function track(partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

function seedContext(id: string, query = 'би-2') {
  return { type: 'search-seed' as const, query, seedTrackId: id }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('search seed is on in dev and production follows only the build flag', () => {
  const source = readFileSync(new URL('./searchSeedPlayback.ts', import.meta.url), 'utf8')
  assert.match(source, /import\.meta\.env\.DEV === true/)
  assert.match(source, /import\.meta\.env\.PROD === true/)
  assert.match(source, /VITE_SEARCH_SEED_PLAYBACK/)
  assert.equal(source.includes('sessionStorage'), false)
  assert.equal(source.includes('swipe-music.dev.search-seed'), false)
  assert.equal(
    resolveSearchSeedPlaybackEnabled({
      production: false,
      dev: true,
      releaseFlag: undefined,
      runtimeOverride: false,
    }),
    true,
  )
  assert.equal(
    resolveSearchSeedPlaybackEnabled({
      production: true,
      dev: false,
      releaseFlag: undefined,
      runtimeOverride: true,
    }),
    false,
  )
  assert.equal(
    resolveSearchSeedPlaybackEnabled({
      production: true,
      dev: false,
      releaseFlag: 'true',
      runtimeOverride: false,
    }),
    true,
  )
  assert.equal(
    resolveSearchSeedPlaybackEnabled({
      production: true,
      dev: false,
      releaseFlag: '1',
      runtimeOverride: true,
    }),
    false,
  )
  assert.equal(isSearchSeedPlaybackEnabled(), false)
  setSearchSeedPlaybackEnabled(true)
  assert.equal(isSearchSeedPlaybackEnabled(), true)
  setSearchSeedPlaybackEnabled(false)
  assert.equal(isSearchSeedPlaybackEnabled(), false)
})

test('search seed playback stays off and the result list remains the legacy queue plan', () => {
  assert.equal(isSearchSeedPlaybackEnabled(), false)
  const results = [
    track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' }),
    track({ sourceId: 'yandex-music', externalId: '2', title: 'Два', artist: 'Б' }),
  ]
  const plan = planSearchPlayback({
    enabled: false,
    tracks: results,
    selectedTrackId: results[1]!.id,
    query: 'би-2',
  })
  assert.equal(plan.mode, 'result-list')
  if (plan.mode === 'result-list') {
    assert.equal(plan.tracks, results)
    assert.equal(plan.tracks.length, 2)
  }
  setSearchSeedPlaybackEnabled(true)
  assert.equal(isSearchSeedPlaybackEnabled(), true)
  setSearchSeedPlaybackEnabled(false)
  assert.equal(isSearchSeedPlaybackEnabled(), false)
})

test('enabled search playback plans one track and does not copy the result list', () => {
  const results = [
    track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' }),
    track({ sourceId: 'yandex-music', externalId: '2', title: 'Два', artist: 'Б' }),
    track({ sourceId: 'yandex-music', externalId: '3', title: 'Три', artist: 'В' }),
  ]
  const plan = planSearchPlayback({
    enabled: true,
    tracks: results,
    selectedTrackId: results[2]!.id,
    query: 'три',
  })
  assert.equal(plan.mode, 'single-track')
  if (plan.mode === 'single-track') {
    assert.equal(plan.track.id, results[2]!.id)
    assert.equal(plan.query, 'три')
  }
  assert.equal(results.length, 3)

  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  const picked = results[2]!
  commitSearchSeedQueue(queue, session, { track: picked, query: 'три' })
  assert.deepEqual(queue.getItems().map((item) => item.id), [picked.id])
  assert.equal(isSearchSeedContext(queue.getPlaybackContext()), true)
  if (isSearchSeedContext(queue.getPlaybackContext())) {
    assert.equal(queue.getPlaybackContext().query, 'три')
    assert.equal(queue.getPlaybackContext().seedTrackId, picked.id)
  }
  assert.equal(results.length, 3)
  assert.equal(isQueueLockedContext(queue.getPlaybackContext()), true)
  assert.equal(
    shouldReplaceHomeQueueWithSwipeFeed({
      queueLocked: true,
      feedLength: results.length,
      queueLength: 0,
    }),
    false,
  )
  assert.equal(
    shouldReplaceHomeQueueWithSwipeFeed({
      queueLocked: false,
      feedLength: results.length,
      queueLength: 0,
      contextType: 'search-seed',
    }),
    false,
  )
})

test('a stale unlocked Home snapshot must not turn search-seed into the result list', () => {
  const results = [
    track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' }),
    track({ sourceId: 'yandex-music', externalId: '2', title: 'Два', artist: 'Б' }),
    track({ sourceId: 'yandex-music', externalId: '3', title: 'Три', artist: 'В' }),
  ]
  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  commitSearchSeedQueue(queue, session, { track: results[0]!, query: 'один' })

  // Как будто React ещё видит пустую незаблокированную очередь.
  const staleWouldReplace = shouldReplaceHomeQueueWithSwipeFeed({
    queueLocked: false,
    feedLength: results.length,
    queueLength: 0,
  })
  assert.equal(staleWouldReplace, true)

  const guarded = shouldReplaceHomeQueueWithSwipeFeed({
    queueLocked: false,
    feedLength: results.length,
    queueLength: 0,
    contextType: queue.getPlaybackContext().type,
  })
  assert.equal(guarded, false)
  assert.deepEqual(queue.getItems().map((item) => item.id), [results[0]!.id])
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
})

/**
 * Тело Home useEffect: решение только по живой PlaybackQueue + contextType.
 * React snapshot намеренно «устаревший» (unlocked, length 0).
 */
function applyHomeFeedEffect(input: {
  queue: PlaybackQueue
  feed: Track[]
  reactQueueLocked: boolean
  reactQueueLength: number
}): boolean {
  const live = input.queue.getSnapshot()
  const liveLocked = isQueueLockedContext(live.context)
  const replace = shouldReplaceHomeQueueWithSwipeFeed({
    queueLocked: input.reactQueueLocked || liveLocked,
    feedLength: input.feed.length,
    queueLength: Math.max(live.items.length, input.reactQueueLength),
    contextType: live.context.type,
  })
  if (!replace) {
    return false
  }
  input.queue.setQueue(input.feed, 0, { type: 'swipe' })
  return true
}

test('Search play then Home mount keeps search-seed through two ended continuations', async () => {
  const searchHits = [
    track({ sourceId: 'yandex-music', externalId: 'hit-a', title: 'Hit A', artist: 'Search' }),
    track({ sourceId: 'yandex-music', externalId: 'hit-b', title: 'Hit B', artist: 'Search' }),
    track({ sourceId: 'yandex-music', externalId: 'hit-c', title: 'Hit C', artist: 'Search' }),
  ]
  const library = [
    track({ sourceId: 'yandex-music', externalId: 'lib-1', title: 'Lib One', artist: 'Shelf' }),
    track({ sourceId: 'yandex-music', externalId: 'lib-2', title: 'Lib Two', artist: 'Shelf' }),
  ]
  let prepareCount = 0
  const queue = new PlaybackQueue()
  const session = new ContinuationSession({
    async prepareContinuation(current) {
      prepareCount += 1
      if (current.id === searchHits[0]!.id) {
        return { track: library[0]! }
      }
      if (current.id === library[0]!.id) {
        return { track: library[1]! }
      }
      return null
    },
  })

  const plan = planSearchPlayback({
    enabled: true,
    tracks: searchHits,
    selectedTrackId: searchHits[0]!.id,
    query: 'hit',
  })
  assert.equal(plan.mode, 'single-track')
  if (plan.mode !== 'single-track') {
    return
  }
  commitSearchSeedQueue(queue, session, { track: plan.track, query: plan.query })
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
  assert.equal(queue.getItems().length, 1)
  assert.equal(queue.current()?.id, searchHits[0]!.id)

  const replaced = applyHomeFeedEffect({
    queue,
    feed: searchHits,
    reactQueueLocked: false,
    reactQueueLength: 0,
  })
  assert.equal(replaced, false)
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
  assert.equal(queue.getItems().length, 1)
  assert.equal(
    queue.getItems().some((item) => item.id === searchHits[1]!.id),
    false,
  )

  await session.flush()
  const first = consumeSearchSeedAdvance(queue, session, { fromEnded: true })
  assert.equal(first?.id, library[0]!.id)
  assert.equal(searchHits.some((item) => item.id === first?.id), false)
  assert.equal(queue.getPlaybackContext().type, 'search-seed')
  session.prepare(first!, queue.getPlaybackContext() as never)
  await session.flush()

  const second = consumeSearchSeedAdvance(queue, session, { fromEnded: true })
  assert.equal(second?.id, library[1]!.id)
  assert.equal(searchHits.some((item) => item.id === second?.id), false)
  assert.ok(prepareCount >= 2)
})

test('stale Home snapshots leave album playlist and radio queues alone', () => {
  const feed = [
    track({ sourceId: 'yandex-music', externalId: 'f1', title: 'Feed', artist: 'X' }),
    track({ sourceId: 'yandex-music', externalId: 'f2', title: 'Feed 2', artist: 'X' }),
  ]
  const album = new PlaybackQueue()
  album.setQueue(
    [track({ sourceId: 'yandex-music', externalId: 'a1', title: 'A', artist: 'Alb' })],
    0,
    { type: 'album', id: 'alb', title: 'Album' },
  )
  assert.equal(
    applyHomeFeedEffect({
      queue: album,
      feed,
      reactQueueLocked: false,
      reactQueueLength: 0,
    }),
    false,
  )
  assert.equal(album.getPlaybackContext().type, 'album')

  const playlist = new PlaybackQueue()
  playlist.setQueue(
    [track({ sourceId: 'yandex-music', externalId: 'p1', title: 'P', artist: 'Pl' })],
    0,
    { type: 'playlist', id: 'pl', title: 'List' },
  )
  assert.equal(
    applyHomeFeedEffect({
      queue: playlist,
      feed,
      reactQueueLocked: false,
      reactQueueLength: 0,
    }),
    false,
  )
  assert.equal(playlist.getPlaybackContext().type, 'playlist')

  const radio = new PlaybackQueue()
  radio.setQueue(
    [track({ sourceId: 'yandex-music', externalId: 'r1', title: 'R', artist: 'Wave' })],
    0,
    { type: 'radio', id: 'my-wave', title: 'Моя волна', origin: 'favorites' },
  )
  assert.equal(
    applyHomeFeedEffect({
      queue: radio,
      feed,
      reactQueueLocked: false,
      reactQueueLength: 0,
    }),
    false,
  )
  assert.equal(radio.getPlaybackContext().type, 'radio')

  const empty = new PlaybackQueue()
  assert.equal(
    applyHomeFeedEffect({
      queue: empty,
      feed,
      reactQueueLocked: false,
      reactQueueLength: 0,
    }),
    true,
  )
  assert.equal(empty.getPlaybackContext().type, 'swipe')
  assert.equal(empty.getItems().length, 2)
})

test('search swipe session stays independent from the playback queue', () => {
  const results = [
    track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' }),
    track({ sourceId: 'yandex-music', externalId: '2', title: 'Два', artist: 'Б' }),
  ]
  const deck = {
    mode: 'search' as const,
    tracks: [results[1]!, results[0]!],
    searchQuery: 'запрос',
  }
  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  commitSearchSeedQueue(queue, session, { track: results[1]!, query: deck.searchQuery })

  assert.equal(deck.mode, 'search')
  assert.equal(deck.searchQuery, 'запрос')
  assert.equal(deck.tracks.length, 2)
  assert.equal(queue.getItems().length, 1)
  assert.notEqual(deck.tracks, queue.getItems())

  const playback = readFileSync(new URL('./searchSeedPlayback.ts', import.meta.url), 'utf8')
  const continuation = readFileSync(new URL('./ContinuationSession.ts', import.meta.url), 'utf8')
  assert.equal(playback.includes('swipeDeckSession'), false)
  assert.equal(playback.includes('searchStore'), false)
  assert.equal(playback.includes('buildPersonalRadio'), false)
  assert.equal(continuation.includes('buildPersonalRadio'), false)
  assert.equal(continuation.includes('personalRadio'), false)
})

test('choosing another search track replaces the seed and drops the stale continuation', async () => {
  const first = track({ sourceId: 'yandex-music', externalId: '1', title: 'Первый', artist: 'А' })
  const second = track({ sourceId: 'yandex-music', externalId: '2', title: 'Второй', artist: 'Б' })
  const stale = track({ sourceId: 'yandex-music', externalId: 'stale', title: 'Старый', artist: 'А' })
  const fresh = track({ sourceId: 'yandex-music', externalId: 'fresh', title: 'Новый', artist: 'Б' })
  const gates = [deferred<{ track: Track } | null>(), deferred<{ track: Track } | null>()]
  let calls = 0
  const provider: ContinuationProvider = {
    prepareContinuation(_current, _context, signal) {
      const gate = gates[calls]!
      calls += 1
      return gate.promise.then((candidate) => (signal.aborted ? null : candidate))
    },
  }
  const session = new ContinuationSession(provider)
  const queue = new PlaybackQueue()
  const generation = session.currentGeneration()
  commitSearchSeedQueue(queue, session, { track: first, query: 'один' })
  commitSearchSeedQueue(queue, session, { track: second, query: 'один' })
  assert.ok(session.currentGeneration() > generation)
  gates[0]!.resolve({ track: stale })
  gates[1]!.resolve({ track: fresh })
  await session.flush()
  assert.equal(calls, 2)
  assert.equal(session.peekPrepared()?.id, fresh.id)
  assert.deepEqual(queue.getItems().map((item) => item.id), [second.id])
  assert.equal(queue.getPlaybackContext().type === 'search-seed' && queue.getPlaybackContext().seedTrackId, second.id)
})

test('duplicate in-flight continuation is not requested twice', () => {
  let calls = 0
  const gate = deferred<{ track: Track } | null>()
  const current = track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' })
  const session = new ContinuationSession({
    prepareContinuation() {
      calls += 1
      return gate.promise
    },
  })
  const context = seedContext(current.id)
  const first = session.prepare(current, context)
  const second = session.prepare(current, context)
  assert.equal(first, second)
  assert.equal(calls, 1)
})

test('unavailable and duplicate candidates are rejected', async () => {
  const current = track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' })
  assert.equal(isContinuationCandidateAvailable(current, current.id, [current]), false)
  assert.equal(
    isContinuationCandidateAvailable(
      track({ sourceId: '', externalId: 'x', title: 'Пусто', artist: 'А' }),
      current.id,
      [],
    ),
    false,
  )

  const session = new ContinuationSession({
    prepareContinuation() {
      return Promise.resolve({ track: current })
    },
  })
  session.prepare(current, seedContext(current.id), { force: true })
  await session.flush()
  assert.equal(session.peekPrepared(), null)

  const missingSource = track({ sourceId: 'yandex-music', externalId: '2', title: 'Два', artist: 'Б' })
  const queue = new PlaybackQueue()
  queue.setQueue([current, missingSource], 1, seedContext(current.id))
  const held = new ContinuationSession({
    prepareContinuation() {
      return Promise.resolve({ track: current })
    },
  })
  held.prepare(missingSource, seedContext(current.id), { force: true })
  await held.flush()
  assert.equal(held.peekPrepared()?.id, current.id)
  const advanced = consumeSearchSeedAdvance(queue, held, { fromEnded: true })
  assert.equal(advanced, null)
  assert.deepEqual(queue.getItems().map((item) => item.id), [current.id, missingSource.id])
  assert.equal(queue.getSnapshot().currentIndex, 1)
})

test('ended and next stay on the seed until a continuation exists, then previous returns', async () => {
  const current = track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' })
  const nextTrack = track({ sourceId: 'yandex-music', externalId: '9', title: 'Дальше', artist: 'Г' })
  const results = [current, track({ sourceId: 'yandex-music', externalId: '2', title: 'Выдача', artist: 'Б' })]
  const queue = new PlaybackQueue()
  const waiting = new ContinuationSession()
  commitSearchSeedQueue(queue, waiting, { track: current, query: 'запрос' })
  await waiting.flush()

  assert.equal(consumeSearchSeedAdvance(queue, waiting, { fromEnded: true }), null)
  assert.equal(queue.getSnapshot().currentIndex, 0)
  assert.equal(consumeSearchSeedAdvance(queue, waiting, { fromEnded: false }), null)
  assert.equal(queue.previous()?.id, current.id)
  assert.deepEqual(results.map((item) => item.id), [current.id, 'yandex-music:2'])

  const ready = new ContinuationSession({
    prepareContinuation() {
      return Promise.resolve({ track: nextTrack })
    },
  })
  ready.prepare(current, seedContext(current.id), { force: true })
  await ready.flush()
  const played = consumeSearchSeedAdvance(queue, ready, { fromEnded: true })
  assert.equal(played?.id, nextTrack.id)
  assert.deepEqual(queue.getItems().map((item) => item.id), [current.id, nextTrack.id])
  assert.equal(queue.previous()?.id, current.id)
  assert.equal(results.length, 2)
})

test('repeat one replays the seed and does not consume a prepared continuation', async () => {
  const current = track({ sourceId: 'yandex-music', externalId: '1', title: 'Один', artist: 'А' })
  const extra = track({ sourceId: 'yandex-music', externalId: '9', title: 'Дальше', artist: 'Г' })
  const queue = new PlaybackQueue()
  queue.setQueue([current], 0, seedContext(current.id))
  queue.setRepeatMode('ONE')
  const session = new ContinuationSession({
    prepareContinuation() {
      return Promise.resolve({ track: extra })
    },
  })
  session.prepare(current, seedContext(current.id), { force: true })
  await session.flush()
  const replayed = consumeSearchSeedAdvance(queue, session, { fromEnded: true })
  assert.equal(replayed?.id, current.id)
  assert.equal(session.peekPrepared()?.id, extra.id)
  assert.equal(queue.getItems().length, 1)
})

test('album, playlist and my wave queues ignore search continuation', async () => {
  const albumTracks = [
    track({ sourceId: 'yandex-music', externalId: 'a', title: 'A', artist: 'Группа' }),
    track({ sourceId: 'yandex-music', externalId: 'b', title: 'B', artist: 'Группа' }),
  ]
  const album = new PlaybackQueue()
  album.setQueue(albumTracks, 0, { type: 'album', id: 'alb', title: 'Альбом', artist: 'Группа' })
  const session = new ContinuationSession({
    prepareContinuation() {
      return Promise.resolve({
        track: track({ sourceId: 'yandex-music', externalId: 'z', title: 'Чужой', artist: 'Х' }),
      })
    },
  })
  session.prepare(albumTracks[0]!, seedContext(albumTracks[0]!.id), { force: true })
  await session.flush()
  assert.equal(consumeSearchSeedAdvance(album, session, { fromEnded: true }), null)
  assert.equal(album.getSnapshot().currentIndex, 0)
  assert.equal(album.next()?.id, albumTracks[1]!.id)
  assert.equal(isQueueLockedContext(album.getPlaybackContext()), true)

  const playlist = new PlaybackQueue()
  playlist.setQueue(albumTracks, 0, { type: 'playlist', id: 'pl', title: 'Список' })
  assert.equal(consumeSearchSeedAdvance(playlist, session, { fromEnded: false }), null)
  assert.equal(playlist.getItems().length, 2)
  assert.equal(isQueueLockedContext(playlist.getPlaybackContext()), true)

  const radio = new PlaybackQueue()
  radio.setQueue(albumTracks, 0, {
    type: 'radio',
    id: 'my-wave',
    title: 'Моя волна',
    origin: 'recommendations',
  })
  assert.equal(consumeSearchSeedAdvance(radio, session, { fromEnded: true }), null)
  assert.equal(radio.peekNext()?.id, albumTracks[1]!.id)
  assert.equal(isQueueLockedContext(radio.getPlaybackContext()), true)

  const legacySearch = new PlaybackQueue()
  legacySearch.setQueue(albumTracks, 0, { type: 'search', query: 'группа' })
  assert.equal(isQueueLockedContext(legacySearch.getPlaybackContext()), false)
  assert.equal(legacySearch.getItems().length, 2)
  assert.equal(parsePlaybackContext({ type: 'search-seed', query: 'q' }).type, 'none')
  const restored = parsePlaybackContext({
    type: 'search-seed',
    query: 'q',
    seedTrackId: albumTracks[0]!.id,
  })
  assert.equal(isSearchSeedContext(restored), true)
})

test('search deck follows the player only outside radio and search-seed', () => {
  assert.equal(searchDeckUsesSeedPlayback({
    enabled: false,
    stage: 'sorting',
    sessionMode: 'search',
  }), false)
  assert.equal(searchDeckUsesSeedPlayback({
    enabled: true,
    stage: 'sorting',
    sessionMode: 'search',
  }), true)
  assert.equal(searchDeckUsesSeedPlayback({
    enabled: true,
    stage: 'wave',
    sessionMode: 'search',
  }), false)
  assert.equal(searchDeckUsesSeedPlayback({
    enabled: true,
    stage: 'sorting',
    sessionMode: 'catalog',
  }), false)
  assert.equal(sortingDeckFollowsPlayer({ radioActive: false, contextType: 'swipe' }), true)
  assert.equal(sortingDeckFollowsPlayer({ radioActive: true, contextType: 'radio' }), false)
  assert.equal(sortingDeckFollowsPlayer({ radioActive: false, contextType: 'search-seed' }), false)
})

test('search card names the player track only when it is not that card', () => {
  const player = { id: 'yandex-music:b', title: 'Love The Way You Lie', artist: 'Eminem, Rihanna' }
  assert.equal(
    continuationPlaybackCaption({
      contextType: 'search-seed',
      cardTrackId: 'yandex-music:a',
      playerTrack: player,
    }),
    'Сейчас играет: Love The Way You Lie — Eminem, Rihanna',
  )
  assert.equal(
    continuationPlaybackCaption({
      contextType: 'search-seed',
      cardTrackId: player.id,
      playerTrack: player,
    }),
    null,
  )
  assert.equal(
    continuationPlaybackCaption({
      contextType: 'radio',
      cardTrackId: 'yandex-music:a',
      playerTrack: player,
    }),
    null,
  )
  assert.equal(
    continuationPlaybackCaption({
      contextType: 'album',
      cardTrackId: 'yandex-music:a',
      playerTrack: player,
    }),
    null,
  )
})

test('search seed uses the existing player singleton and does not construct another', () => {
  const player = readFileSync(new URL('../audioPlayer/AudioPlayer.ts', import.meta.url), 'utf8')
  const intent = readFileSync(new URL('../playbackIntent/PlaybackIntent.ts', import.meta.url), 'utf8')
  const adapter = readFileSync(new URL('../audioPlayer/HtmlAudioPlayerAdapter.ts', import.meta.url), 'utf8')
  assert.match(player, /let singleton: AudioPlayer \| null = null/)
  assert.match(player, /export function getAudioPlayer\(\)/)
  assert.equal(player.split('new AudioPlayer').length - 1, 1)
  assert.equal(player.includes('new Audio('), false)
  assert.match(player, /playSearchSeedAdvance/)
  assert.match(intent, /async playSearchTrack/)
  assert.match(intent, /getAudioPlayer\(\)/)
  assert.equal(intent.includes('new AudioPlayer'), false)
  assert.equal(intent.includes('new Audio('), false)
  assert.equal(adapter.split('new Audio(').length - 1, 1)
})
