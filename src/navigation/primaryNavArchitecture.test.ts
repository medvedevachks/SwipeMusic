import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bottomNav = readFileSync(new URL('../components/BottomNav.tsx', import.meta.url), 'utf8')
const header = readFileSync(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../layouts/MainLayout.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const audioPlayer = readFileSync(
  new URL('../services/audioPlayer/AudioPlayer.ts', import.meta.url),
  'utf8',
)

test('bottom nav has exactly four tabs in contract order', () => {
  const labels = [...bottomNav.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(labels, ['Свайпы', 'Моя волна', 'Поиск', 'Библиотека'])
  const tos = [...bottomNav.matchAll(/to: '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(tos, ['/', '/wave', '/search', '/library'])
  assert.equal(bottomNav.includes('/profile'), false)
  assert.equal(bottomNav.includes('Профиль'), false)
})

test('profile lives in header; search is not duplicated there', () => {
  assert.match(header, /to="\/profile"/)
  assert.match(header, /aria-label="Профиль"/)
  assert.equal(header.includes('to="/search"'), false)
  assert.equal(header.includes('aria-label="Поиск"'), false)
})

test('app routes expose / wave search library without nested home tabs', () => {
  assert.match(app, /path="wave"/)
  assert.match(app, /<Wave \/>/)
  assert.match(app, /element=\{<Home stage="sorting" \/>\}/)
  assert.match(app, /path="search"/)
  assert.match(app, /path="library"/)
  assert.match(app, /path="profile"/)
  // /queue остаётся технически, без новых точек входа из нижней навигации.
  assert.match(app, /path="queue"/)
  assert.equal(bottomNav.includes('/queue'), false)
})

test('shell keeps header → main → dock(player+nav) and safe-area dock', () => {
  assert.match(layout, /AppHeader/)
  assert.match(layout, /app-main/)
  assert.match(layout, /BottomPlayer/)
  assert.match(layout, /BottomNav/)
  assert.match(layout, /app-dock/)
  const headerIdx = layout.indexOf('AppHeader')
  const mainIdx = layout.indexOf('app-main')
  const dockIdx = layout.indexOf('app-dock')
  const playerIdx = layout.indexOf('BottomPlayer')
  const navIdx = layout.indexOf('BottomNav')
  assert.ok(headerIdx < mainIdx && mainIdx < dockIdx)
  assert.ok(playerIdx < navIdx)
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100svh/s)
  assert.match(css, /\.app-dock\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/s)
  assert.match(css, /\.app-main\s*\{[^}]*overflow-x:\s*hidden/s)
})

test('AudioPlayer remains a singleton factory — nav does not add a second player', () => {
  assert.match(audioPlayer, /let singleton: AudioPlayer \| null = null/)
  assert.match(audioPlayer, /export function getAudioPlayer/)
  assert.equal(layout.includes('new AudioPlayer'), false)
  assert.equal(bottomNav.includes('AudioPlayer'), false)
  assert.equal(app.includes('new AudioPlayer'), false)
})

test('library still owns catalogs; home no longer embeds HomeCatalogsPanel', () => {
  const library = readFileSync(new URL('../pages/Library.tsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../pages/Home.tsx', import.meta.url), 'utf8')
  assert.match(library, /CatalogList/)
  assert.equal(home.includes('HomeCatalogsPanel'), false)
  assert.equal(home.includes('Каталоги'), false)
})
