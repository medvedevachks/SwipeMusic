import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  albumCatalogPath,
  artistCatalogPath,
} from '../navigation/catalogPaths.ts'
import { createTrack } from '../sources/normalizeTrack.ts'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const row = readFileSync(
  new URL('../components/search/SearchResultRow.tsx', import.meta.url),
  'utf8',
)
const artistPage = readFileSync(new URL('./ArtistPage.tsx', import.meta.url), 'utf8')
const albumPage = readFileSync(new URL('./AlbumPage.tsx', import.meta.url), 'utf8')
const yandexMap = readFileSync(
  new URL('../sources/adapters/yandex-music/mapTrack.ts', import.meta.url),
  'utf8',
)
const spotifyMap = readFileSync(
  new URL('../sources/adapters/spotify/mapTrack.ts', import.meta.url),
  'utf8',
)
const trackType = readFileSync(
  new URL('../types/track.ts', import.meta.url),
  'utf8',
)

test('catalog paths target existing artist/album routes', () => {
  assert.equal(
    artistCatalogPath('yandex-music', '42'),
    '/search/artists/yandex-music/42',
  )
  assert.equal(
    albumCatalogPath('spotify', 'ab/cd'),
    '/search/albums/spotify/ab%2Fcd',
  )
})

test('Track and createTrack carry optional artist/album external ids', () => {
  assert.match(trackType, /artistExternalId\?:/)
  assert.match(trackType, /albumExternalId\?:/)
  const track = createTrack({
    sourceId: 'demo',
    externalId: '1',
    title: 'T',
    artist: 'A',
    album: 'B',
    artistExternalId: 'a1',
    albumExternalId: 'b1',
  })
  assert.equal(track.artistExternalId, 'a1')
  assert.equal(track.albumExternalId, 'b1')
})

test('yandex and spotify mappers populate artist/album external ids', () => {
  assert.match(yandexMap, /artistExternalId/)
  assert.match(yandexMap, /albumExternalId/)
  assert.match(yandexMap, /firstArtist/)
  assert.match(spotifyMap, /artistExternalId/)
  assert.match(spotifyMap, /albumExternalId/)
  assert.match(spotifyMap, /spotifyTrack\.album\.id/)
})

test('search row exposes artist/album links without replacing play', () => {
  assert.match(row, /onOpenArtist/)
  assert.match(row, /onOpenAlbum/)
  assert.match(row, /search-result-play/)
  assert.match(row, /search-result-artist-link/)
  assert.match(row, /search-result-album-link/)
  assert.match(row, /onPlay/)
})

test('search wires track links to existing artist/album pages', () => {
  assert.match(search, /artistCatalogPath/)
  assert.match(search, /albumCatalogPath/)
  assert.match(search, /onOpenArtist/)
  assert.match(search, /onOpenAlbum/)
  assert.match(search, /playSearchTrack/)
  assert.equal(search.includes('TrackPage'), false)
  assert.equal(search.includes('AudioPlayer'), false)
  assert.equal(search.includes("from '../services/sessionSwitch"), false)
  assert.equal(search.includes("from '../services/audioPlayer"), false)
})

test('SRC-05 reuses ArtistPage and AlbumPage instead of new track pages', () => {
  assert.match(artistPage, /playSearchTrack/)
  assert.match(albumPage, /playAlbum/)
  assert.equal(artistPage.includes('AudioPlayer'), false)
  assert.equal(albumPage.includes('PlaybackQueue'), false)
})
