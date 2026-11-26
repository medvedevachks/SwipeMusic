import assert from 'node:assert/strict'
import test from 'node:test'
import {
  likedRefTrackId,
  parseLikedTrackRefsPayload,
  resolveHydratedTracksForBatch,
} from './likedTracksParse.ts'

test('parseLikedTrackRefsPayload accepts confirmed empty tracks array', () => {
  const parsed = parseLikedTrackRefsPayload({ library: { tracks: [] } })
  assert.deepEqual(parsed, { ok: true, refs: [] })
})

test('parseLikedTrackRefsPayload maps id and albumId refs', () => {
  const parsed = parseLikedTrackRefsPayload({
    library: {
      tracks: [{ id: 1, albumId: 9 }, { id: '2' }, { id: 3, albumId: '' }],
    },
  })
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(parsed.refs, ['1:9', '2', '3'])
  }
})

test('parseLikedTrackRefsPayload rejects missing library as incomplete, not empty', () => {
  assert.deepEqual(parseLikedTrackRefsPayload({}), {
    ok: false,
    reason: 'missing-library',
  })
  assert.deepEqual(parseLikedTrackRefsPayload({ library: null }), {
    ok: false,
    reason: 'missing-library',
  })
  assert.deepEqual(parseLikedTrackRefsPayload(null), {
    ok: false,
    reason: 'missing-library',
  })
})

test('parseLikedTrackRefsPayload rejects missing tracks field as incomplete', () => {
  assert.deepEqual(parseLikedTrackRefsPayload({ library: {} }), {
    ok: false,
    reason: 'missing-tracks',
  })
  assert.deepEqual(parseLikedTrackRefsPayload({ library: { tracks: null } }), {
    ok: false,
    reason: 'invalid-tracks',
  })
  assert.deepEqual(
    parseLikedTrackRefsPayload({ library: { tracks: { id: 1 } } }),
    { ok: false, reason: 'invalid-tracks' },
  )
})

test('parseLikedTrackRefsPayload rejects items without id', () => {
  assert.deepEqual(
    parseLikedTrackRefsPayload({ library: { tracks: [{ albumId: 1 }] } }),
    { ok: false, reason: 'invalid-item' },
  )
})

test('resolveHydratedTracksForBatch stubs unavailable ids when some match', () => {
  const resolved = resolveHydratedTracksForBatch(
    ['10:1', '20', '30'],
    [{ id: 10, title: 'Keep' }, { id: '30', title: 'Also', available: false }],
  )
  assert.equal(resolved.ok, true)
  if (resolved.ok) {
    assert.equal(resolved.tracks.length, 3)
    assert.equal(String(resolved.tracks[0]?.id), '10')
    assert.equal(resolved.tracks[1]?.title, 'Unavailable track')
    assert.equal(resolved.tracks[1]?.available, false)
    assert.equal(String(resolved.tracks[2]?.id), '30')
  }
})

test('resolveHydratedTracksForBatch rejects empty or non-array responses', () => {
  assert.deepEqual(resolveHydratedTracksForBatch(['1'], null), {
    ok: false,
    reason: 'invalid-response',
  })
  assert.deepEqual(resolveHydratedTracksForBatch(['1', '2'], []), {
    ok: false,
    reason: 'empty-response',
  })
  assert.deepEqual(
    resolveHydratedTracksForBatch(['1', '2'], [{ title: 'no-id' }]),
    { ok: false, reason: 'invalid-track' },
  )
})

test('resolveHydratedTracksForBatch rejects responses with zero id matches', () => {
  assert.deepEqual(
    resolveHydratedTracksForBatch(['1', '2'], [{ id: 99, title: 'Other' }]),
    { ok: false, reason: 'no-matches' },
  )
})

test('likedRefTrackId strips album suffix', () => {
  assert.equal(likedRefTrackId('42:7'), '42')
  assert.equal(likedRefTrackId('42'), '42')
})
