import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const searchPage = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const row = readFileSync(
  new URL('../components/search/SearchResultRow.tsx', import.meta.url),
  'utf8',
)
const yandexMap = readFileSync(
  new URL('../sources/adapters/yandex-music/mapTrack.ts', import.meta.url),
  'utf8',
)

test('search UI is a single track list without artist/album pages', () => {
  assert.match(searchPage, /SearchResultRow/)
  assert.match(searchPage, /data-testid="search-track-list"/)
  assert.match(searchPage, /Песни:/)
  assert.equal(searchPage.includes('/artist'), false)
  assert.equal(searchPage.includes('/album'), false)
  assert.equal(searchPage.includes('ArtistsPage'), false)
  assert.equal(searchPage.includes('AlbumsPage'), false)
})

test('search result row shows cover, title, artist, album, source', () => {
  assert.match(row, /coverUrl/)
  assert.match(row, /track\.title/)
  assert.match(row, /track\.artist/)
  assert.match(row, /track\.album/)
  assert.match(row, /getSourceDisplayName/)
})

test('search result row shows playability only when known', () => {
  assert.match(row, /resolveSearchTrackPlayability/)
  assert.match(row, /searchPlayabilityLabel/)
  assert.match(row, /data-playability/)
  assert.match(row, /playabilityLabel \?/)
})

test('search keeps infinite scroll and load-more control', () => {
  assert.match(searchPage, /IntersectionObserver/)
  assert.match(searchPage, /Загрузить ещё/)
  assert.match(searchPage, /searchNext/)
  assert.match(searchPage, /loadMoreSentinelRef/)
})

test('partial provider failures surface as warning with results kept', () => {
  assert.match(searchPage, /providerWarnings/)
  assert.match(searchPage, /Часть источников недоступна/)
  assert.match(searchPage, /data-testid="search-provider-warnings"/)
  assert.match(searchPage, /providerWarnings\.length > 0 && results\.length > 0/)
})

test('Play and swipe entry points remain on Search page', () => {
  assert.match(searchPage, /playSearchResult/)
  assert.match(searchPage, /playSearchTrack/)
  assert.match(searchPage, /openAllInSwipes/)
  assert.match(searchPage, /Открыть все в свайпах/)
})

test('Yandex mapper attaches playability only from available flag', () => {
  assert.match(yandexMap, /withSearchPlayabilityTags/)
  assert.match(yandexMap, /track\.available/)
})
