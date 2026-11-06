import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
const homeDeck = readFileSync(
  new URL('../services/recommendation/homeDeck.ts', import.meta.url),
  'utf8',
)

test('search result Play starts SEARCH session then opens swipe deck on /', () => {
  assert.match(search, /playSearchResult/)
  assert.match(search, /playSearchTrack/)
  assert.match(search, /Открыть все в свайпах/)
  assert.match(search, /openAllInSwipes/)

  const playFn = search.slice(
    search.indexOf('const playSearchResult'),
    search.indexOf('const openAllInSwipes'),
  )
  // NAV-SEARCH-01: Play → / после seed; без dump hits в SWIPES-колоду.
  assert.match(playFn, /playSearchTrack/)
  assert.match(playFn, /navigate\('\/'\)/)
  assert.equal(playFn.includes('applySearchDeck'), false)
  assert.equal(/getPlaybackIntent\(\)[\s\S]*playFromSwipe/.test(playFn), false)
  // Дождаться commit SEARCH, затем маршрут — меньше гонки с cold SWIPES seed.
  assert.match(playFn, /await getPlaybackIntent\(\)\.playSearchTrack/)
})

test('explicit open-all-in-swipes navigates to / without starting playback', () => {
  const openFn = search.slice(
    search.indexOf('const openAllInSwipes'),
    search.indexOf('const onSubmit'),
  )
  assert.match(openFn, /applySearchDeck/)
  assert.match(openFn, /navigate\('\/'\)/)
  assert.equal(openFn.includes('playSearchTrack'), false)
  assert.equal(openFn.includes('playFromSwipe'), false)
})

test('Home playback deck follows search-seed without treating UI as SWIPES session', () => {
  assert.match(homeDeck, /context\.type === 'search-seed'/)
  assert.match(homeDeck, /isRecommendationHomeDeckContext/)
  // Cold SWIPES seed не стартует в search deck mode; idle guard в commitRecommendationSeed.
  assert.match(home, /stage !== 'sorting' \|\| mode === 'search'/)
  assert.match(home, /requireIdleQueue:\s*true/)
  assert.match(home, /search-seed/)
})
