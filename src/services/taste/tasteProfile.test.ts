import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUserTasteProfile, keyId, readUserTasteProfile } from './buildTasteProfile.ts'
import { createTasteProfileCache } from './profileCache.ts'
import { tasteProfileAsRadioLibrary } from './radioAdapter.ts'
import type { TasteInput, TasteLibraryTrack, TastePlaybackEvent, UserTasteProfile } from './types.ts'
import { TASTE_WEIGHTS } from './weights.ts'

const NOW = '2026-10-27T12:00:00.000Z'

function input(partial: Partial<TasteInput> = {}): TasteInput {
  return {
    library: [],
    catalogs: [],
    stats: [],
    events: [],
    history: [],
    ...partial,
  }
}

function liked(partial: Partial<TasteLibraryTrack> = {}): TasteLibraryTrack {
  return {
    canonicalTrackId: 'canon-1',
    title: 'Север',
    artist: 'Поле',
    liked: true,
    disliked: false,
    hidden: false,
    playCount: 0,
    skipped: 0,
    lastPlayed: null,
    catalogIds: [],
    copies: [{ sourceId: 'yandex-music', externalId: 'ya-1', canonicalTrackId: 'canon-1' }],
    ...partial,
  }
}

function event(partial: Partial<TastePlaybackEvent>): TastePlaybackEvent {
  return {
    sessionId: 'session-1',
    eventType: 'playback_started',
    sourceId: 'yandex-music',
    externalId: 'ya-1',
    canonicalTrackId: 'canon-1',
    listenedMs: 0,
    durationMs: 180_000,
    reason: null,
    createdAt: NOW,
    ...partial,
  }
}

function profileOf(value: TasteInput, userId = 'user-a'): UserTasteProfile {
  return buildUserTasteProfile(userId, value, NOW)
}

function trackScore(profile: UserTasteProfile, canonicalTrackId: string): number {
  return profile.tracks.find((track) => track.key.kind === 'canonical' && track.key.canonicalTrackId === canonicalTrackId)?.score ?? 0
}

function origins(profile: UserTasteProfile): string[] {
  return profile.tracks.flatMap((track) => track.signals.map((signal) => signal.origin)).sort()
}

test('a new account without history has an empty profile', () => {
  const profile = profileOf(input())
  assert.equal(profile.empty, true)
  assert.deepEqual(profile.tracks, [])
  assert.deepEqual(profile.catalogs, [])
  assert.equal(profile.userId, 'user-a')
})

test('likes alone are a strong explicit signal', () => {
  const profile = profileOf(input({ library: [liked()] }))
  assert.equal(trackScore(profile, 'canon-1'), TASTE_WEIGHTS.explicitLike)
  assert.deepEqual(origins(profile), ['canonical-like'])
  assert.equal(profile.tracks[0]?.signals[0]?.confidence, 'explicit')
})

test('playback history without a like is not treated as a like', () => {
  const profile = profileOf(input({
    events: [
      event({ eventType: 'playback_started', listenedMs: 0 }),
      event({ eventType: 'playback_progress', listenedMs: 40_000, createdAt: '2026-10-27T12:00:15.000Z' }),
    ],
  }))
  assert.equal(origins(profile).includes('canonical-like'), false)
  assert.equal(trackScore(profile, 'canon-1'), TASTE_WEIGHTS.confirmedListen)
  assert.equal(profile.tracks[0]?.signals[0]?.confidence, 'observed')
})

test('likes, listens and catalogs stay separate facts', () => {
  const profile = profileOf(input({
    catalogs: [{ id: 'night', name: 'Ночная дорога' }],
    library: [liked({ catalogIds: ['night'], playCount: 4 })],
    events: [
      event({ eventType: 'playback_started' }),
      event({ eventType: 'playback_completed', listenedMs: 180_000, createdAt: '2026-10-27T12:03:00.000Z' }),
    ],
  }))
  const score = trackScore(profile, 'canon-1')
  assert.equal(score, TASTE_WEIGHTS.explicitLike + TASTE_WEIGHTS.confirmedListen + TASTE_WEIGHTS.completion)
  assert.equal(profile.catalogs[0]?.name, 'Ночная дорога')
  assert.equal(profile.catalogs[0]?.trackKeys[0]?.kind, 'canonical')
  assert.equal(score > TASTE_WEIGHTS.explicitLike, true)
  assert.equal(JSON.stringify(profile.catalogs).includes('genre'), false)
})

test('an early skip is a weak penalty and a very short skip is not', () => {
  const early = profileOf(input({
    events: [
      event({ eventType: 'playback_started' }),
      event({ eventType: 'playback_skipped', listenedMs: 8_000, reason: 'next', createdAt: '2026-10-27T12:00:08.000Z' }),
    ],
  }))
  const tooShort = profileOf(input({
    events: [
      event({ eventType: 'playback_started' }),
      event({ eventType: 'playback_skipped', listenedMs: 3_000, reason: 'next', createdAt: '2026-10-27T12:00:03.000Z' }),
    ],
  }))
  assert.equal(trackScore(early, 'canon-1'), TASTE_WEIGHTS.earlySkip)
  assert.equal(trackScore(tooShort, 'canon-1'), 0)
  assert.equal(early.tracks[0]?.signals[0]?.origin, 'playback-early-skip')
  assert.notEqual(early.tracks[0]?.signals[0]?.origin, 'canonical-dislike')
})

test('a playback failure is not a dislike', () => {
  const profile = profileOf(input({
    library: [liked({ liked: false })],
    events: [
      event({ eventType: 'playback_started' }),
      event({
        eventType: 'playback_failed',
        listenedMs: 1_000,
        reason: 'load-failed',
        createdAt: '2026-10-27T12:00:02.000Z',
      }),
    ],
  }))
  assert.equal(profile.empty, true)
  assert.equal(origins(profile).includes('canonical-dislike'), false)
})

test('repeated progress in one session is a single listen', () => {
  const events = [event({ eventType: 'playback_started' })]
  for (let index = 1; index <= 6; index += 1) {
    events.push(event({
      eventType: 'playback_progress',
      listenedMs: index * 10_000,
      createdAt: `2026-10-27T12:00:0${index}.000Z`,
    }))
  }
  const profile = profileOf(input({ events }))
  assert.equal(trackScore(profile, 'canon-1'), TASTE_WEIGHTS.confirmedListen)
})

test('pause and resume do not add plays', () => {
  const playing = profileOf(input({
    events: [
      event({ eventType: 'playback_started' }),
      event({ eventType: 'playback_progress', listenedMs: 40_000, createdAt: '2026-10-27T12:00:20.000Z' }),
    ],
  }))
  const paused = profileOf(input({
    events: [
      event({ eventType: 'playback_started' }),
      event({ eventType: 'playback_paused', listenedMs: 40_000, createdAt: '2026-10-27T12:00:20.000Z' }),
      event({ eventType: 'playback_resumed', listenedMs: 40_000, createdAt: '2026-10-27T12:00:40.000Z' }),
    ],
  }))
  assert.equal(trackScore(paused, 'canon-1'), trackScore(playing, 'canon-1'))
})

test('source copies of one canonical track share a score and a title match does not', () => {
  const merged = profileOf(input({
    library: [liked({
      copies: [
        { sourceId: 'yandex-music', externalId: 'ya-1', canonicalTrackId: 'canon-1' },
        { sourceId: 'local-folder', externalId: 'file-1', canonicalTrackId: 'canon-1' },
      ],
    })],
    events: [
      event({ sourceId: 'yandex-music', externalId: 'ya-1', listenedMs: 0 }),
      event({ sourceId: 'yandex-music', externalId: 'ya-1', eventType: 'playback_progress', listenedMs: 40_000, createdAt: '2026-10-27T12:00:20.000Z' }),
      event({
        sessionId: 'session-2',
        sourceId: 'local-folder',
        externalId: 'file-1',
        eventType: 'playback_completed',
        listenedMs: 180_000,
        createdAt: '2026-10-27T13:00:00.000Z',
      }),
    ],
  }))
  assert.equal(merged.tracks.length, 1)
  assert.equal(merged.tracks[0]?.copies.length, 2)
  assert.equal(
    trackScore(merged, 'canon-1'),
    TASTE_WEIGHTS.explicitLike + TASTE_WEIGHTS.confirmedListen * 2 + TASTE_WEIGHTS.completion,
  )

  const sameName = profileOf(input({
    library: [
      liked({ canonicalTrackId: 'canon-a', title: 'Север', artist: 'Поле' }),
      liked({
        canonicalTrackId: 'canon-b',
        title: 'Север',
        artist: 'Поле',
        copies: [{ sourceId: 'yandex-music', externalId: 'ya-2', canonicalTrackId: 'canon-b' }],
      }),
    ],
  }))
  assert.deepEqual(
    sameName.tracks.map((track) => keyId(track.key)),
    ['canonical:canon-a', 'canonical:canon-b'],
  )
})

test('an unknown canonical id stays on the source identity', () => {
  const profile = profileOf(input({
    events: [
      event({
        canonicalTrackId: null,
        externalId: 'loose-1',
        eventType: 'playback_completed',
        listenedMs: 180_000,
      }),
    ],
  }))
  assert.equal(profile.tracks.length, 1)
  assert.equal(profile.tracks[0]?.key.kind, 'source')
  assert.equal(profile.tracks.some((track) => track.key.kind === 'canonical'), false)
})

test('many listens of one track cannot outweigh an explicit like', () => {
  const events = []
  for (let index = 0; index < 8; index += 1) {
    events.push(event({
      sessionId: `session-${index}`,
      eventType: 'playback_completed',
      listenedMs: 180_000,
      createdAt: `2026-10-27T12:0${index}:00.000Z`,
    }))
  }
  const played = profileOf(input({ events }))
  const loved = profileOf(input({ library: [liked({ liked: true, copies: [] })] }))
  assert.equal(played.tracks[0]?.score, TASTE_WEIGHTS.maxListenContribution + TASTE_WEIGHTS.maxCompletionContribution)
  assert.equal((loved.tracks[0]?.score ?? 0) > (played.tracks[0]?.score ?? 0), true)
})

test('the same input always builds the same profile', () => {
  const first = input({
    catalogs: [{ id: 'b', name: 'Вторая' }, { id: 'a', name: 'Первая' }],
    library: [
      liked({ canonicalTrackId: 'b', catalogIds: ['b'] }),
      liked({ canonicalTrackId: 'a', catalogIds: ['a'], copies: [{ sourceId: 'yandex-music', externalId: 'ya-a', canonicalTrackId: 'a' }] }),
    ],
  })
  const reversed = input({
    catalogs: [...first.catalogs].reverse(),
    library: [...first.library].reverse(),
  })
  const left = profileOf(first)
  const right = profileOf(reversed)
  assert.deepEqual(left.tracks.map((track) => track.score), right.tracks.map((track) => track.score))
  assert.deepEqual(left.catalogs, right.catalogs)
})

test('the profile has no genre, mood or similarity fields', () => {
  const profile = profileOf(input({
    catalogs: [{ id: 'roads', name: 'Дорога' }],
    library: [liked({ catalogIds: ['roads'] })],
  }))
  const keys = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return
    }
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key)
      visit(nested)
    }
  }
  visit(profile)
  for (const forbidden of ['genre', 'mood', 'tag', 'tags', 'similarity', 'similar']) {
    assert.equal(keys.has(forbidden), false)
  }
})

test('a profile cache belongs to one user and drops when the account changes', () => {
  const cache = createTasteProfileCache()
  const library = input({ library: [liked()] })
  const first = cache.read('user-a', library, NOW)
  const again = cache.read('user-a', library, NOW)
  assert.equal(again, first)
  const other = cache.read('user-b', input(), NOW)
  assert.equal(other.userId, 'user-b')
  assert.equal(other.empty, true)
  assert.notEqual(other, first)
  cache.invalidate('user-b')
  const rebuilt = cache.read('user-a', library, '2026-10-27T13:00:00.000Z')
  assert.equal(rebuilt.builtAt, '2026-10-27T13:00:00.000Z')
  assert.equal(rebuilt.userId, 'user-a')
})

test('a broken analytics snapshot does not throw', () => {
  const broken = input()
  Object.defineProperty(broken, 'library', {
    get() {
      throw new Error('analytics down')
    },
  })
  const profile = readUserTasteProfile('user-a', broken, NOW)
  assert.equal(profile.empty, true)
  assert.equal(profile.userId, 'user-a')
})

test('the radio adapter keeps canonical likes and drops demo copies', () => {
  const profile = profileOf(input({
    library: [
      liked(),
      liked({
        canonicalTrackId: 'demo',
        copies: [{ sourceId: 'mock', externalId: 'midnight', canonicalTrackId: 'demo' }],
      }),
    ],
    history: [{
      action: 'like',
      sourceId: 'yandex-music',
      externalId: 'only-source',
      canonicalTrackId: null,
      catalogId: null,
      createdAt: NOW,
    }],
  }))
  const seeds = tasteProfileAsRadioLibrary(profile)
  assert.deepEqual(seeds.map((item) => item.canonicalId), ['canon-1'])
  assert.equal(seeds[0]?.liked, true)
  assert.equal(seeds[0]?.copies[0]?.sourceId, 'yandex-music')
})

test('the live player does not build a taste profile on its own', () => {
  const files = [
    'src/services/personalRadio/myWaveRuntime.ts',
    'src/services/continuation/ContinuationSession.ts',
    'src/services/playbackAnalytics/runtime.ts',
    'src/services/playbackQueue/PlaybackQueue.ts',
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.equal(source.includes('buildUserTasteProfile'), false)
    assert.equal(source.includes('selection: \'taste\''), false)
  }
})

test('events, stats and the library counter are not added together', () => {
  const events = [
    event({ eventType: 'playback_started' }),
    event({ eventType: 'playback_completed', listenedMs: 180_000, createdAt: '2026-10-27T12:03:00.000Z' }),
  ]
  const once = profileOf(input({
    library: [liked({ liked: false, playCount: 9 })],
    events,
  }))
  const stacked = profileOf(input({
    library: [liked({ liked: false, playCount: 9 })],
    events,
    stats: [{
      sourceId: 'yandex-music',
      externalId: 'ya-1',
      canonicalTrackId: 'canon-1',
      playCount: 9,
      completedCount: 9,
      skippedCount: 0,
      listenedMs: 1_620_000,
    }],
  }))
  assert.equal(trackScore(stacked, 'canon-1'), trackScore(once, 'canon-1'))
  assert.equal(trackScore(once, 'canon-1'), TASTE_WEIGHTS.confirmedListen + TASTE_WEIGHTS.completion)
})

test('a changed like, listen or catalog rebuilds the cached profile', () => {
  const cache = createTasteProfileCache()
  const base = input({ library: [liked({ liked: false })], catalogs: [{ id: 'roads', name: 'Дорога' }] })
  assert.equal(cache.read('user-a', base, NOW).empty, true)
  const likedInput = input({ library: [liked({ catalogIds: ['roads'] })], catalogs: base.catalogs })
  const next = cache.read('user-a', likedInput, NOW)
  assert.equal(trackScore(next, 'canon-1'), TASTE_WEIGHTS.explicitLike)
  assert.equal(next.catalogs[0]?.catalogId, 'roads')
  cache.invalidate()
  const afterLogout = cache.read('user-a', likedInput, '2026-10-27T18:00:00.000Z')
  assert.equal(afterLogout.builtAt, '2026-10-27T18:00:00.000Z')
})
