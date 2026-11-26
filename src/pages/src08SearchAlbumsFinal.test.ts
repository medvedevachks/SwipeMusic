/**
 * SRC-08 — финальная проверка блока 4.
 * Не дублирует SRC-01…07 целиком: только подтверждённый пробел
 * (stale loadMore на Artist/Album) + якоря уже закрытых контрактов.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const artistPage = readFileSync(new URL('./ArtistPage.tsx', import.meta.url), 'utf8')
const albumPage = readFileSync(new URL('./AlbumPage.tsx', import.meta.url), 'utf8')
const searchStore = readFileSync(
  new URL('../store/searchStore.ts', import.meta.url),
  'utf8',
)
const searchEngine = readFileSync(
  new URL('../services/searchEngine/SearchEngine.ts', import.meta.url),
  'utf8',
)

test('artist loadMore ignores stale pages after artist/route change', () => {
  assert.match(
    artistPage,
    /const loadMoreTracks = async[\s\S]*?const generation = loadGen\.current[\s\S]*?generation !== loadGen\.current/,
  )
  assert.match(
    artistPage,
    /const loadMoreAlbums = async[\s\S]*?const generation = loadGen\.current[\s\S]*?generation !== loadGen\.current/,
  )
})

test('album loadMore ignores stale pages after album/route change', () => {
  assert.match(
    albumPage,
    /const loadMore = async[\s\S]*?const generation = loadGen\.current[\s\S]*?generation !== loadGen\.current/,
  )
})

test('block 4 keeps search race guards and session playback entry points', () => {
  assert.match(searchEngine, /nextFlightGeneration/)
  assert.match(searchEngine, /searchGeneration/)
  assert.match(searchStore, /isCurrentArtistSearchGeneration/)
  assert.match(searchStore, /commitRecentSearchIfAuthCurrent/)
  assert.match(artistPage, /playSearchTrack/)
  assert.match(albumPage, /playAlbum/)
})
