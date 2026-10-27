import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyPlaybackSignal, summarizePlaybackEvents } from './classifySignal.ts'
import { PlaybackOutbox } from './outbox.ts'
import { reportPlayback, setPlaybackAnalyticsSink } from './report.ts'
import { createPlaybackAnalyticsRuntime } from './runtime.ts'
import { PlaybackAnalyticsMachine } from './sessionMachine.ts'
import { PLAYBACK_EVENT, PLAYBACK_REASON, type PlaybackEvent, type TrackIdentityRef } from './types.ts'

function machine(): PlaybackAnalyticsMachine {
  let index = 0
  return new PlaybackAnalyticsMachine(
    () => '2026-10-27T12:00:00.000Z',
    () => {
      index += 1
      return `session-${index}`
    },
  )
}

function identity(externalId: string, canonicalTrackId: string | null = null): TrackIdentityRef {
  return { sourceId: 'yandex-music', externalId, canonicalTrackId }
}

function audible(
  target: PlaybackAnalyticsMachine,
  externalId: string,
  canonicalTrackId: string | null = null,
  durationMs: number | null = 180_000,
): PlaybackEvent[] {
  return target.apply({
    type: 'audible',
    ...identity(externalId, canonicalTrackId),
    positionMs: 0,
    durationMs,
  })
}

function walk(target: PlaybackAnalyticsMachine, from: number, to: number, step = 1_000): PlaybackEvent[] {
  const events: PlaybackEvent[] = []
  for (let position = from; position <= to; position += step) {
    events.push(...target.apply({ type: 'time', positionMs: position }))
  }
  return events
}

test('a full track counts one play and one completion', () => {
  const target = machine()
  const started = audible(target, 'track-1', null, 20_000)
  walk(target, 1_000, 20_000)
  const ended = target.apply({ type: 'ended', positionMs: 20_000, durationMs: 20_000 })
  const again = target.apply({ type: 'ended', positionMs: 20_000, durationMs: 20_000 })
  const summary = summarizePlaybackEvents([...started, ...ended])
  assert.equal(summary.playCount, 1)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.skippedCount, 0)
  assert.equal(ended[0]?.listenedMs, 20_000)
  assert.equal(again.length, 0)
  assert.equal(classifyPlaybackSignal({
    durationMs: 20_000,
    listenedMs: 20_000,
    completed: true,
    skipped: false,
    failed: false,
  }), 'completed')
})

test('an early next is a skip with position and is not dislike by itself', () => {
  const target = machine()
  audible(target, 'track-1', null, 180_000)
  walk(target, 1_000, 3_000)
  const skipped = target.apply({ type: 'skip', reason: PLAYBACK_REASON.NEXT, positionMs: 3_000 })
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0]?.eventType, PLAYBACK_EVENT.SKIPPED)
  assert.equal(skipped[0]?.reason, 'next')
  assert.equal(skipped[0]?.positionMs, 3_000)
  assert.equal(skipped[0]?.listenedMs, 3_000)
  assert.equal(classifyPlaybackSignal({
    durationMs: 180_000,
    listenedMs: 3_000,
    completed: false,
    skipped: true,
    failed: false,
  }), 'none')
  assert.equal(classifyPlaybackSignal({
    durationMs: 180_000,
    listenedMs: 8_000,
    completed: false,
    skipped: true,
    failed: false,
  }), 'early-skip')
})

test('pause and resume stay inside one playback session', () => {
  const target = machine()
  const started = audible(target, 'track-1')
  walk(target, 1_000, 2_000)
  const paused = target.apply({ type: 'paused', positionMs: 2_000 })
  const ignored = target.apply({ type: 'time', positionMs: 9_000 })
  const resumed = target.apply({ type: 'resumed', positionMs: 2_000 })
  walk(target, 3_000, 4_000)
  const ended = target.apply({ type: 'ended', positionMs: 4_000, durationMs: 180_000 })
  const summary = summarizePlaybackEvents([...started, ...paused, ...resumed, ...ended])
  assert.equal(summary.playCount, 1)
  assert.equal(paused[0]?.sessionId, resumed[0]?.sessionId)
  assert.equal(ignored.length, 0)
  assert.equal(ended[0]?.listenedMs, 4_000)
})

test('seeking and replaying a fragment does not double listened time', () => {
  const target = machine()
  audible(target, 'track-1', null, 60_000)
  walk(target, 1_000, 10_000)
  target.apply({ type: 'seek', positionMs: 0 })
  walk(target, 1_000, 10_000)
  target.apply({ type: 'seek', positionMs: 30_000 })
  walk(target, 31_000, 35_000)
  const ended = target.apply({ type: 'ended', positionMs: 35_000, durationMs: 60_000 })
  assert.equal(ended[0]?.listenedMs, 15_000)
})

test('repeat after the real end starts a second confirmed play', () => {
  const target = machine()
  const first = audible(target, 'track-1', null, 10_000)
  walk(target, 1_000, 10_000)
  const firstEnd = target.apply({ type: 'ended', positionMs: 10_000, durationMs: 10_000 })
  const second = audible(target, 'track-1', null, 10_000)
  const summary = summarizePlaybackEvents([...first, ...firstEnd, ...second])
  assert.equal(summary.playCount, 2)
  assert.equal(summary.completedCount, 1)
  assert.equal(second[0]?.eventType, PLAYBACK_EVENT.STARTED)
  assert.notEqual(second[0]?.sessionId, firstEnd[0]?.sessionId)
})

test('switching source of the same composition does not count another play', () => {
  const target = machine()
  const first = audible(target, 'copy-a', 'canonical-1', 180_000)
  target.apply({
    type: 'intent',
    ...identity('copy-b', 'canonical-1'),
    preserveQueue: true,
  })
  const second = audible(target, 'copy-b', 'canonical-1', 180_000)
  const summary = summarizePlaybackEvents([...first, ...second])
  assert.equal(summary.playCount, 1)
  assert.equal(summary.skippedCount, 0)
  assert.equal(second.length, 0)
  assert.equal(first[0]?.sessionId, 'session-1')
})

test('a load failure before sound does not increment play count', () => {
  const target = machine()
  const failed = target.apply({
    type: 'failed',
    ...identity('missing'),
    reason: PLAYBACK_REASON.LOAD_FAILED,
  })
  const summary = summarizePlaybackEvents(failed)
  assert.equal(summary.playCount, 0)
  assert.equal(failed[0]?.eventType, PLAYBACK_EVENT.FAILED)
  assert.equal(failed[0]?.canonicalTrackId, null)
})

test('rapid next commands close the session once', () => {
  const target = machine()
  const firstPlay = audible(target, 'track-1')
  walk(target, 1_000, 2_000)
  const first = target.apply({ type: 'skip', reason: PLAYBACK_REASON.NEXT, positionMs: 2_000 })
  const second = target.apply({ type: 'skip', reason: PLAYBACK_REASON.NEXT, positionMs: 2_000 })
  const replacement = audible(target, 'track-2')
  assert.equal(first.length, 1)
  assert.equal(second.length, 0)
  assert.equal(replacement.length, 1)
  assert.equal(summarizePlaybackEvents([...firstPlay, ...first, ...replacement]).playCount, 2)
})

test('a search track is identified by source id without a canonical row', () => {
  const target = machine()
  const started = audible(target, 'ya-99')
  assert.equal(started[0]?.sourceId, 'yandex-music')
  assert.equal(started[0]?.externalId, 'ya-99')
  assert.equal(started[0]?.canonicalTrackId, null)
  const runtime = readFileSync(new URL('./runtime.ts', import.meta.url), 'utf8')
  assert.equal(runtime.includes('ensureIdentity'), false)
  assert.equal(runtime.includes('buildPersonalRadio'), false)
})

test('browsing cards without playback is not a playback skip', () => {
  const target = machine()
  assert.deepEqual(target.apply({ type: 'deck-gesture' }), [])
})

test('progress is sparse and a throwing analytics sink cannot stop playback', () => {
  const target = machine()
  audible(target, 'track-1', null, 200_000)
  const progress = walk(target, 1_000, 130_000)
  const progressEvents = progress.filter((event) => event.eventType === PLAYBACK_EVENT.PROGRESS)
  assert.ok(progressEvents.length <= 8)
  assert.ok(progressEvents.length < 20)
  assert.ok(progress.length < 130)

  let called = false
  setPlaybackAnalyticsSink(() => {
    called = true
    throw new Error('analytics failed')
  })
  assert.doesNotThrow(() => {
    reportPlayback({ type: 'deck-gesture' })
  })
  assert.equal(called, true)
  setPlaybackAnalyticsSink(() => {})
})

test('offline delivery and a user switch do not mix or drop the other user', async () => {
  let user: string | null = 'user-a'
  let online = false
  const sent: Array<{ userId: string; ids: string[] }> = []
  let sequence = 0
  const runtime = createPlaybackAnalyticsRuntime({
    now: () => '2026-10-27T12:00:00.000Z',
    newId: () => {
      sequence += 1
      return `sess-${sequence}`
    },
    userId: () => user,
    canonicalId: () => null,
    transport: async (userId, events) => {
      if (!online) {
        return 'offline'
      }
      sent.push({ userId, ids: events.map((event) => event.eventId) })
      return 'ok'
    },
    outbox: new PlaybackOutbox(),
  })
  runtime.ingest({
    type: 'audible',
    ...identity('search-1'),
    positionMs: 0,
    durationMs: 10_000,
  })
  await runtime.flush()
  assert.equal(sent.length, 0)
  user = 'user-b'
  runtime.ingest({ type: 'resumed', positionMs: 4_000 })
  runtime.ingest({ type: 'time', positionMs: 8_000 })
  await runtime.flush()
  assert.equal(sent.length, 0)
  online = true
  runtime.ingest({
    type: 'audible',
    ...identity('track-b'),
    positionMs: 0,
    durationMs: 10_000,
  })
  await runtime.flush()
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.userId, 'user-b')
  assert.deepEqual(
    sent[0]?.ids.every((id) => id.startsWith('sess-2_')),
    true,
  )
  user = 'user-a'
  await runtime.flush()
  assert.equal(sent.length, 2)
  assert.equal(sent[1]?.userId, 'user-a')
  assert.deepEqual(
    sent[1]?.ids.every((id) => id.startsWith('sess-1_')),
    true,
  )
  await runtime.flush()
  assert.equal(sent.length, 2)
})

test('an aborted batch is not confirmed for another account and returns to its owner', async () => {
  let user: string | null = 'user-a'
  const outbox = new PlaybackOutbox()
  const sent: Array<{ userId: string; ids: string[] }> = []
  let deliver = false
  let sequence = 0
  const runtime = createPlaybackAnalyticsRuntime({
    now: () => '2026-10-27T12:00:00.000Z',
    newId: () => {
      sequence += 1
      return `sess-${sequence}`
    },
    userId: () => user,
    canonicalId: () => null,
    outbox,
    transport: (_userId, _events, signal) => new Promise((resolve) => {
      if (deliver) {
        sent.push({ userId: _userId, ids: _events.map((event) => event.eventId) })
        resolve('ok')
        return
      }
      signal.addEventListener('abort', () => resolve('ok'), { once: true })
    }),
  })
  runtime.ingest({
    type: 'audible',
    ...identity('track-a'),
    positionMs: 0,
    durationMs: 30_000,
  })
  runtime.ingest({ type: 'time', positionMs: 15_000 })
  runtime.ingest({ type: 'skip', reason: 'next', positionMs: 16_000 })
  const held = outbox.holdCount('user-a')
  assert.ok(held >= 2)
  const pending = runtime.flush()
  await Promise.resolve()
  user = null
  runtime.syncOwner()
  await pending
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.equal(sent.length, 0)
  assert.equal(outbox.holdCount('user-a'), held)

  user = 'user-b'
  deliver = true
  runtime.ingest({
    type: 'audible',
    ...identity('track-b'),
    positionMs: 0,
    durationMs: 30_000,
  })
  await runtime.flush()
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.deepEqual(sent.map((batch) => batch.userId), ['user-b'])
  assert.equal(sent[0]?.ids.some((id) => id.startsWith('sess-1_')), false)
  assert.equal(outbox.holdCount('user-a'), held)

  user = 'user-a'
  await runtime.flush()
  await new Promise((resolve) => queueMicrotask(resolve))
  assert.equal(sent.at(-1)?.userId, 'user-a')
  assert.equal(sent.at(-1)?.ids.some((id) => id.startsWith('sess-1_')), true)
  assert.equal(outbox.holdCount('user-a'), 0)
  assert.equal(outbox.holdCount('user-b'), 0)
})

test('rejected authentication keeps the owner queue and a bad payload is dropped once', async () => {
  let user: string | null = 'user-a'
  const outbox = new PlaybackOutbox()
  const sent: string[] = []
  let result: 'offline' | 'reject' | 'ok' = 'offline'
  const runtime = createPlaybackAnalyticsRuntime({
    now: () => '2026-10-27T12:00:00.000Z',
    newId: () => 'sess-auth',
    userId: () => user,
    canonicalId: () => null,
    outbox,
    transport: async (userId) => {
      sent.push(userId)
      return result
    },
  })
  runtime.ingest({
    type: 'audible',
    ...identity('track-a'),
    positionMs: 0,
    durationMs: 10_000,
  })
  await runtime.flush()
  assert.deepEqual(sent, ['user-a'])
  assert.equal(outbox.holdCount('user-a'), 1)
  user = 'user-b'
  await runtime.flush()
  assert.deepEqual(sent, ['user-a'])
  user = 'user-a'
  result = 'reject'
  await runtime.flush()
  assert.equal(outbox.holdCount('user-a'), 0)
  assert.deepEqual(sent, ['user-a', 'user-a'])
})

test('the same event id can wait for two owners without being sent together', () => {
  const outbox = new PlaybackOutbox()
  const event = {
    eventId: 'shared-event',
    sessionId: 'sess',
    eventType: PLAYBACK_EVENT.STARTED,
    sourceId: 'yandex-music',
    externalId: 'track',
    canonicalTrackId: null,
    positionMs: 0,
    listenedMs: 0,
    durationMs: 1_000,
    reason: null,
    createdAt: '2026-10-27T12:00:00.000Z',
  }
  outbox.append('user-a', [event])
  outbox.append('user-b', [event])
  assert.deepEqual(outbox.peek('user-a', 10).map((item) => item.eventId), ['shared-event'])
  assert.deepEqual(outbox.peek('user-b', 10).map((item) => item.eventId), ['shared-event'])
  outbox.ack('user-b', ['shared-event'])
  assert.equal(outbox.holdCount('user-a'), 1)
  assert.equal(outbox.holdCount('user-b'), 0)
})
