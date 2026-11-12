/**
 * SRC-06 — контракты интеграции поиска с воспроизведением.
 * Аудит 2026-11-12: подтверждённых обрывов цепочек не найдено;
 * тесты фиксируют существующую проводку без новых движков/очередей.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const artistPage = readFileSync(new URL('./ArtistPage.tsx', import.meta.url), 'utf8')
const albumPage = readFileSync(new URL('./AlbumPage.tsx', import.meta.url), 'utf8')
const intent = readFileSync(
  new URL('../services/playbackIntent/PlaybackIntent.ts', import.meta.url),
  'utf8',
)
const playSearch = readFileSync(
  new URL(
    '../services/sessionSwitch/integration/playSearchSession.ts',
    import.meta.url,
  ),
  'utf8',
)
const playAlbum = readFileSync(
  new URL(
    '../services/sessionSwitch/integration/playAlbumSession.ts',
    import.meta.url,
  ),
  'utf8',
)
const audioPlayer = readFileSync(
  new URL('../services/audioPlayer/AudioPlayer.ts', import.meta.url),
  'utf8',
)

test('Search Play awaits playSearchTrack then navigates Home for SEARCH deck', () => {
  const playFn = search.slice(
    search.indexOf('const playSearchResult'),
    search.indexOf('const openAllInSwipes'),
  )
  assert.match(playFn, /await getPlaybackIntent\(\)\.playSearchTrack/)
  assert.match(playFn, /navigate\('\/'\)/)
  assert.equal(playFn.includes('playAlbum'), false)
  assert.equal(playFn.includes('playFromSwipe'), false)
  assert.equal(playFn.includes('new PlaybackQueue'), false)
  assert.equal(playFn.includes('AudioPlayer'), false)
})

test('Artist track Play uses SEARCH session via playSearchTrack, not ALBUM', () => {
  const playFn = artistPage.slice(
    artistPage.indexOf('const playTrack'),
    artistPage.indexOf('if (loading)'),
  )
  assert.match(playFn, /await getPlaybackIntent\(\)\.playSearchTrack/)
  assert.match(playFn, /searchHits:\s*tracks/)
  assert.match(playFn, /navigate\('\/'\)/)
  assert.equal(playFn.includes('playAlbum'), false)
  assert.equal(playFn.includes("from '../services/sessionSwitch"), false)
  assert.equal(playFn.includes("from '../services/audioPlayer"), false)
})

test('Album Play uses playAlbum ALBUM session, not search-seed', () => {
  assert.match(albumPage, /getPlaybackIntent\(\)\.playAlbum/)
  assert.match(albumPage, /startIndex/)
  assert.equal(albumPage.includes('playSearchTrack'), false)
  assert.equal(albumPage.includes('new AudioPlayer'), false)
  assert.equal(albumPage.includes('PlaybackQueue'), false)
})

test('PlaybackIntent routes search and album through SessionSwitch helpers', () => {
  assert.match(intent, /playSearchViaSessionSwitch/)
  assert.match(intent, /playAlbumViaSessionSwitch/)
  assert.match(intent, /target: 'search'|playSearchViaSessionSwitch/)
  assert.match(playSearch, /target:\s*'search'/)
  assert.match(playSearch, /type:\s*'search-seed'/)
  assert.match(playSearch, /hardExcludeHits/)
  assert.match(playSearch, /bindCmeOwnershipFromRuntime\('search'\)/)
  assert.match(playAlbum, /target:\s*'album'/)
  assert.match(playAlbum, /type:\s*'album'/)
  assert.match(playAlbum, /clearCmeSessionOwnership/)
})

test('AudioPlayer keeps one next path for search-seed CME and album-related end', () => {
  assert.match(audioPlayer, /playRecommendationAdvance/)
  assert.match(audioPlayer, /albumRelatedContinuation/)
  assert.match(audioPlayer, /async next\(/)
  // Единый класс — без параллельного плеера в интеграционных страницах.
  assert.equal(search.includes('new AudioPlayer'), false)
  assert.equal(artistPage.includes('new AudioPlayer'), false)
  assert.equal(albumPage.includes('new AudioPlayer'), false)
})
