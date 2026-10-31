/**
 * PLAYBACK-FIX-02: SessionSwitch strips previewUrl; DEV adapter must still
 * resolve stream via catalog identity (id / externalId).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { toSessionTrack } from '../../../services/playbackSession/sanitizeTrack.ts'
import { sessionTrackAsTrack } from '../../../services/sessionSwitch/integration/sessionTrackAsTrack.ts'
import { buildDevAcceptanceCatalog } from './catalog.ts'
import { createDevAcceptanceAdapter } from './devAcceptanceAdapter.ts'

test('DEV acceptance resolve works after SessionTrack strips previewUrl', async () => {
  const catalog = buildDevAcceptanceCatalog()
  const source = catalog.find((track) => track.externalId === 'kino-blood')
  assert.ok(source)
  assert.ok(source.previewUrl)

  const session = toSessionTrack(source)
  assert.equal(
    'previewUrl' in session && (session as { previewUrl?: unknown }).previewUrl,
    false,
  )
  const forPrepare = sessionTrackAsTrack(session)
  assert.equal(forPrepare.previewUrl, null)
  assert.equal(forPrepare.externalId, 'kino-blood')

  const adapter = createDevAcceptanceAdapter()
  const candidates = await adapter.getPlaybackCandidates(forPrepare)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.available, true)
  assert.ok(candidates[0]?.url)
  assert.match(String(candidates[0]?.url), /kino1\.wav/)
})

test('DEV acceptance album metadata groups Би-2 for ALBUM session', () => {
  const bi2 = buildDevAcceptanceCatalog().filter((track) => track.artist === 'Би-2')
  assert.equal(bi2.length, 2)
  assert.ok(bi2.every((track) => track.album === 'Нечётный воин'))
})

test('DEV acceptance catalog groups three named albums', () => {
  const albums = new Set(
    buildDevAcceptanceCatalog()
      .map((track) => track.album?.trim())
      .filter((album): album is string => Boolean(album)),
  )
  assert.ok(albums.has('Нечётный воин'))
  assert.ok(albums.has('Группа крови'))
  assert.ok(albums.has('Прости меня моя любовь'))
})
