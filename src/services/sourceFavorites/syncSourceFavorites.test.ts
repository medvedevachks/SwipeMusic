import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { SOURCE_FAVORITES_CHUNK } from './syncSourceFavorites.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('source favorites sync chunks without artificial track cap', () => {
  assert.ok(SOURCE_FAVORITES_CHUNK >= 20)
  assert.ok(SOURCE_FAVORITES_CHUNK <= 100)
  const source = readFileSync(join(here, 'syncSourceFavorites.ts'), 'utf8')
  assert.match(source, /finalize/)
  assert.match(source, /libraryClient\.syncSourceFavorites/)
  assert.equal(source.includes('slice(0, 30)'), false)
  assert.equal(source.includes('patchCanonicalLiked'), false)
  assert.equal(source.includes('assignCanonical'), false)
})

test('Yandex syncLibrary wires source favorites after likes fetch', () => {
  const adapter = readFileSync(
    join(here, '../../sources/adapters/yandex-music/YandexMusicAdapter.ts'),
    'utf8',
  )
  assert.match(adapter, /syncSourceFavorites/)
  assert.match(adapter, /getLikedTracks/)
  // Лайки источника не лимитируются slice на getLikedTracks.
  const likesBlock = adapter.slice(
    adapter.indexOf('const liked = await this.api.getLikedTracks'),
    adapter.indexOf('const playlistsRaw'),
  )
  assert.equal(likesBlock.includes('.slice('), false)
})

test('API route and schema encode source favorites table', () => {
  const routes = readFileSync(
    join(here, '../../../server/http/libraryRoutes.ts'),
    'utf8',
  )
  const schema = readFileSync(join(here, '../../../server/db/database.ts'), 'utf8')
  assert.ok(routes.includes('createSourceFavoritesRepository'))
  assert.ok(routes.includes('validateSourceFavoritesSyncBody'))
  assert.ok(routes.includes('favorites'))
  assert.ok(routes.includes('sourceFavorites.sync'))
  assert.ok(schema.includes('user_source_favorites'))
  assert.ok(schema.includes('last_seen_at'))
})
