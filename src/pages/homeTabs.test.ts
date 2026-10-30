import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Home exposes three tabs without extending HomeStage', () => {
  const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
  assert.match(home, /type HomeTab = 'sorting' \| 'wave' \| 'catalogs'/)
  assert.match(home, /HomeCatalogsPanel/)
  assert.match(home, /Каталоги/)
  assert.match(home, /home-mode-tabs/)
  assert.equal(home.includes("HomeStage = 'sorting' | 'wave' | 'catalogs'"), false)

  const stage = readFileSync(
    new URL('../services/personalRadio/homeStage.ts', import.meta.url),
    'utf8',
  )
  assert.match(stage, /export type HomeStage = 'sorting' \| 'wave'/)
})

test('Home tab clicks only switch UI and do not activate recommendations', () => {
  const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
  const tabsBlock = home.slice(
    home.indexOf('role="tablist"'),
    home.indexOf('</div>', home.indexOf('role="tablist"') + 1),
  )
  assert.match(tabsBlock, /setHomeTab\('sorting'\)/)
  assert.match(tabsBlock, /setHomeTab\('wave'\)/)
  assert.match(tabsBlock, /setHomeTab\('catalogs'\)/)
  assert.equal(tabsBlock.includes('activateRecommendationSession'), false)
  assert.match(home, /hidden=\{homeTab !== 'catalogs'\}/)
  assert.match(home, /home-deck-pane" hidden=\{homeTab !== 'sorting'\}/)
  assert.match(home, /home-deck-pane" hidden=\{homeTab !== 'wave'\}/)
})

test('home-mode-tabs CSS keeps three equal columns for mobile width', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /\.home-mode-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(css, /\.home-mode-tab\s*\{[^}]*min-width:\s*0/s)
  assert.match(css, /\.home-mode-tab\s*\{[^}]*overflow:\s*hidden/s)
})

test('Home opens sorting for sys_swipes inbox and removes sorted from queue', () => {
  const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
  assert.match(home, /SYS_SWIPES_ID/)
  assert.match(home, /focusHomeTab/)
  assert.match(home, /removeSortedCanonicalFromSwipesQueue/)
  assert.match(home, /forceProvider: active === 'wave'/)
})

test('LibraryFolder swipes Play navigates to Home sorting session', () => {
  const folder = readFileSync(new URL('./LibraryFolder.tsx', import.meta.url), 'utf8')
  assert.match(folder, /startSwipeInboxSorting/)
  assert.match(folder, /focusHomeTab: 'sorting'/)
  assert.match(folder, /folderId === 'swipes'/)
  // Favorites / my-music остаются на playUserCatalog.
  assert.match(folder, /playUserCatalog/)
})
