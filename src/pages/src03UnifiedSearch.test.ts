import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const artistPage = readFileSync(new URL('./ArtistPage.tsx', import.meta.url), 'utf8')
const albumPage = readFileSync(new URL('./AlbumPage.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const searchStore = readFileSync(
  new URL('../store/searchStore.ts', import.meta.url),
  'utf8',
)
const yandexApi = readFileSync(
  new URL('../sources/adapters/yandex-music/api.ts', import.meta.url),
  'utf8',
)
const spotifyPort = readFileSync(
  new URL('../services/catalogBrowse/spotifyCatalogPort.ts', import.meta.url),
  'utf8',
)

test('unified search has no tabs and shows artists then songs', () => {
  assert.match(search, /search-artists-section/)
  assert.match(search, /Исполнители/)
  assert.match(search, /Песни:/)
  assert.equal(search.includes('role="tablist"'), false)
  assert.equal(search.includes('Tabs'), false)
  assert.match(search, /SearchArtistRow/)
  assert.match(search, /SearchResultRow/)
})

test('artist and album routes are registered', () => {
  assert.match(app, /search\/artists\/:sourceId\/:artistId/)
  assert.match(app, /search\/albums\/:sourceId\/:albumId/)
  assert.match(app, /ArtistPage/)
  assert.match(app, /AlbumPage/)
})

test('artist page paginates tracks and albums via catalog browse', () => {
  assert.match(artistPage, /getArtistTracks/)
  assert.match(artistPage, /getArtistAlbums/)
  assert.match(artistPage, /Ещё песни/)
  assert.match(artistPage, /Ещё альбомы/)
  assert.match(artistPage, /IntersectionObserver/)
  assert.match(artistPage, /playSearchTrack/)
})

test('artist page navigates home only after await playSearchTrack', () => {
  const playTrackBlock = artistPage.match(
    /const playTrack =[\s\S]*?navigate\('\/'\)/,
  )?.[0]
  assert.ok(playTrackBlock, 'playTrack handler must exist')
  assert.match(playTrackBlock, /await getPlaybackIntent\(\)\.playSearchTrack/)
  assert.match(playTrackBlock, /navigate\('\/'\)/)
  const awaitIndex = playTrackBlock.indexOf('await getPlaybackIntent().playSearchTrack')
  const navigateIndex = playTrackBlock.indexOf("navigate('/')")
  assert.ok(awaitIndex >= 0 && navigateIndex > awaitIndex)
})

test('search store guards artists against stale responses and supports cursor paging', () => {
  assert.match(searchStore, /bumpArtistSearchGeneration/)
  assert.match(searchStore, /isCurrentArtistSearchGeneration/)
  assert.match(searchStore, /AbortController/)
  assert.match(searchStore, /searchArtistsNext/)
  assert.match(searchStore, /sourceCursors/)
  assert.match(searchStore, /artistsAbort\?\.abort/)
})

test('unified search exposes artists load-more via provider cursors', () => {
  assert.match(search, /searchArtistsNext/)
  assert.match(search, /search-artists-load-more/)
  assert.match(search, /artistsHasMore/)
  assert.match(search, /Ещё исполнители/)
})

test('album page plays through PlaybackIntent.playAlbum', () => {
  assert.match(albumPage, /playAlbum/)
  assert.match(albumPage, /getAlbumTracks/)
  assert.match(albumPage, /Загрузить ещё/)
  assert.equal(albumPage.includes('AudioPlayer'), false)
  assert.equal(albumPage.includes('SessionSwitch'), false)
})

test('yandex catalog uses real artist/album endpoints not search hits', () => {
  assert.match(yandexApi, /type=artist/)
  assert.match(yandexApi, /\/artists\/\$\{/)
  assert.match(yandexApi, /direct-albums/)
  assert.match(yandexApi, /with-tracks/)
})

test('spotify artist tracks are album-derived not search-fabricated', () => {
  assert.match(spotifyPort, /album-derived/)
  assert.match(spotifyPort, /getArtistAlbums/)
  assert.match(spotifyPort, /getAlbumTracks/)
  assert.equal(spotifyPort.includes("type: 'track'"), false)
})
