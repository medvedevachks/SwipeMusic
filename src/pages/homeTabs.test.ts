import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Home is a single-stage screen without nested mode tabs or catalogs panel', () => {
  const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
  assert.match(home, /type HomeProps/)
  assert.match(home, /stage\?: HomeStage/)
  assert.equal(home.includes('HomeTab'), false)
  assert.equal(home.includes('home-mode-tabs'), false)
  assert.equal(home.includes('HomeCatalogsPanel'), false)
  assert.equal(home.includes('focusHomeTab'), false)
  assert.equal(home.includes("HomeStage = 'sorting' | 'wave' | 'catalogs'"), false)

  const stage = readFileSync(
    new URL('../services/personalRadio/homeStage.ts', import.meta.url),
    'utf8',
  )
  assert.match(stage, /export type HomeStage = 'sorting' \| 'wave'/)
})

test('route stage does not activate recommendations and cold seed stays on sorting only', () => {
  const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8')
  assert.match(home, /stage !== 'sorting' \|\| mode === 'search'/)
  assert.match(home, /removeSortedCanonicalFromSwipesQueue/)
  assert.match(home, /forceProvider: active === 'wave'/)
  // Смена экрана — маршрут, не setHomeTab / activate из UI-табов.
  assert.equal(home.includes('setHomeTab'), false)
  assert.equal(/role="tablist"/.test(home), false)
})

test('Wave page reuses Home with wave stage', () => {
  const wave = readFileSync(new URL('./Wave.tsx', import.meta.url), 'utf8')
  assert.match(wave, /from '\.\/Home'/)
  assert.match(wave, /stage="wave"/)
})

test('LibraryFolder swipes Play navigates to / without focusHomeTab', () => {
  const folder = readFileSync(new URL('./LibraryFolder.tsx', import.meta.url), 'utf8')
  assert.match(folder, /startSwipeInboxSorting/)
  assert.match(folder, /navigate\('\/'\)/)
  assert.equal(folder.includes('focusHomeTab'), false)
  assert.match(folder, /folderId === 'swipes'/)
  assert.match(folder, /playUserCatalog/)
})
