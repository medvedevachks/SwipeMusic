import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')

test('search result Play stays on /search and uses playSearchTrack only', () => {
  assert.match(search, /playSearchResult/)
  assert.match(search, /playSearchTrack/)
  assert.match(search, /Открыть все в свайпах/)
  assert.match(search, /openAllInSwipes/)

  // Строка результата не уводит на главную и не подменяет колоду SWIPES.
  const playFn = search.slice(
    search.indexOf('const playSearchResult'),
    search.indexOf('const openAllInSwipes'),
  )
  assert.equal(playFn.includes("navigate('/)"), false)
  assert.equal(playFn.includes('applySearchDeck'), false)
  assert.match(playFn, /playSearchTrack/)
  assert.equal(/getPlaybackIntent\(\)[\s\S]*playFromSwipe/.test(playFn), false)
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
