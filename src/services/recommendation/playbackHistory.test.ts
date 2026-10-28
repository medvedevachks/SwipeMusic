import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import { ContinuationSession } from '../continuation/ContinuationSession.ts'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { consumeRecommendationAdvance } from './advance.ts'

function track(
  partial: Partial<Track> & Pick<Track, 'sourceId' | 'externalId' | 'title' | 'artist'>,
): Track {
  return {
    id: partial.id ?? `${partial.sourceId}:${partial.externalId}`,
    ...partial,
  }
}

test('Previous walks history; Next replays queue before calling engine', () => {
  const queue = new PlaybackQueue()
  const session = new ContinuationSession()
  const atl = track({
    sourceId: 'dev-acceptance',
    externalId: 'atl',
    title: 'ATL',
    artist: 'Сплин',
  })
  const kino = track({
    sourceId: 'dev-acceptance',
    externalId: 'kino-blood',
    title: 'Группа крови',
    artist: 'Кино',
  })
  const zem = track({
    sourceId: 'dev-acceptance',
    externalId: 'zem-iskala',
    title: 'Искала',
    artist: 'Земфира',
  })
  const bi2 = track({
    sourceId: 'dev-acceptance',
    externalId: 'bi2-polkovnik',
    title: 'Полковнику никто не пишет',
    artist: 'Би-2',
  })

  queue.setQueue([atl], 0, {
    type: 'search-seed',
    query: 'Сплин',
    seedTrackId: atl.id,
    hardExcludeHits: [
      { id: atl.id, title: atl.title, artist: atl.artist, sourceId: atl.sourceId, externalId: atl.externalId },
    ],
  })
  queue.insertNext(kino)
  queue.next()
  queue.insertNext(zem)
  queue.next()
  queue.insertNext(bi2)
  queue.next()

  assert.equal(queue.current()?.id, bi2.id)
  assert.equal(queue.getSnapshot().currentIndex, 3)
  assert.equal(queue.getItems().length, 4)

  assert.equal(queue.previous()?.id, zem.id)
  assert.equal(queue.previous()?.id, kino.id)
  assert.equal(queue.previous()?.id, atl.id)
  assert.equal(queue.getSnapshot().currentIndex, 0)
  // Курсор уходит назад, длина истории не сжимается (replay, не новая ветка).
  assert.equal(queue.getSnapshot().history.length, 4)
  assert.equal(queue.getSnapshot().historyIndex, 0)

  // Prefetch must not steal history Next.
  session.prepare(
    atl,
    { type: 'search-seed', query: 'Сплин', seedTrackId: atl.id },
    { force: true },
  )

  const forward1 = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(forward1?.id, kino.id)
  assert.equal(queue.getSnapshot().currentIndex, 1)
  assert.equal(queue.getSnapshot().historyIndex, 1)
  assert.equal(session.peekPrepared(), null)

  const forward2 = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(forward2?.id, zem.id)
  assert.equal(queue.getSnapshot().historyIndex, 2)

  const forward3 = consumeRecommendationAdvance(queue, session, { fromEnded: false })
  assert.equal(forward3?.id, bi2.id)
  assert.equal(queue.peekNext(), null)
  assert.equal(queue.getSnapshot().history.length, 4)
  assert.equal(queue.getSnapshot().historyIndex, 3)

  // hardExcludeHits preserved through history walk
  const ctx = queue.getPlaybackContext()
  assert.equal(ctx.type, 'search-seed')
  if (ctx.type === 'search-seed') {
    assert.ok((ctx.hardExcludeHits?.length ?? 0) >= 1)
  }
})
