import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SYS_SWIPES_ID } from '../services/catalogs/systemFolders.ts'
import {
  isUserCatalogPlayback,
  resolveCatalogPlaybackTitle,
  shouldOpenFullscreenAfterCatalogPlay,
} from './catalogFullscreen.ts'

test('isUserCatalogPlayback: SessionSwitch catalog id', () => {
  assert.equal(
    isUserCatalogPlayback({
      context: { type: 'none' },
      activeSessionId: 'catalog',
    }),
    true,
  )
})

test('isUserCatalogPlayback: playlist context excludes sys_swipes', () => {
  assert.equal(
    isUserCatalogPlayback({
      context: { type: 'playlist', id: 'cat_a', title: 'Acceptance A' },
      activeSessionId: null,
    }),
    true,
  )
  assert.equal(
    isUserCatalogPlayback({
      context: { type: 'playlist', id: SYS_SWIPES_ID, title: 'Свайпы' },
      activeSessionId: null,
    }),
    false,
  )
  assert.equal(
    isUserCatalogPlayback({
      context: { type: 'search', query: 'q' },
      activeSessionId: 'search',
    }),
    false,
  )
})

test('resolveCatalogPlaybackTitle reads playlist title', () => {
  assert.equal(
    resolveCatalogPlaybackTitle({
      type: 'playlist',
      id: 'cat_a',
      title: 'Acceptance A',
    }),
    'Acceptance A',
  )
  assert.equal(
    resolveCatalogPlaybackTitle({
      type: 'playlist',
      id: SYS_SWIPES_ID,
      title: 'Свайпы',
    }),
    null,
  )
  assert.equal(resolveCatalogPlaybackTitle({ type: 'none' }), null)
})

test('shouldOpenFullscreenAfterCatalogPlay only on played', () => {
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'played' }), true)
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'empty' }), false)
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'busy' }), false)
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'error' }), false)
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'unavailable' }), false)
})

test('CatalogDetail opens fullscreen only after successful CATALOG play', () => {
  const source = readFileSync(new URL('../pages/CatalogDetail.tsx', import.meta.url), 'utf8')
  assert.match(source, /openFullscreenPlayer/)
  assert.match(source, /shouldOpenFullscreenAfterCatalogPlay/)
  assert.match(source, /playUserCatalog/)
  const runPlay = source.slice(
    source.indexOf('const runPlay'),
    source.indexOf('const catalogBusy'),
  )
  assert.match(runPlay, /status === 'played'/)
  assert.match(runPlay, /openFullscreenPlayer\(navigate, location\)/)
  assert.match(runPlay, /playBusyRef/)
  // Пустой каталог не запускает play — кнопка disabled.
  assert.match(source, /disabled=\{anyBusy \|\| tracks\.length === 0\}/)
})

test('FullscreenPlayer shows CATALOG queue list without second AudioPlayer', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /isUserCatalogPlayback/)
  assert.match(source, /resolveCatalogPlaybackTitle/)
  assert.match(source, /fullscreen-player-catalog-list/)
  assert.match(source, /fullscreen-player-catalog-title/)
  assert.match(source, /playFromQueue/)
  assert.equal(source.includes('new AudioPlayer'), false)
  assert.equal(source.includes('getAudioPlayer('), false)
  // Список берётся из queue store, не отдельная копия каталога.
  assert.match(source, /useGlobalPlayerStore\(\(s\) => s\.queue\)/)
})

test('shell CSS keeps transport above catalog list on short landscape', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /\.fullscreen-player-catalog-list/)
  assert.match(
    css,
    /orientation:\s*landscape\)\s*and\s*\(max-height:\s*720px\)[\s\S]*'list list'/,
  )
  assert.match(
    css,
    /orientation:\s*landscape\)\s*and\s*\(max-height:\s*720px\)[\s\S]*fullscreen-player-transport[\s\S]*fullscreen-player-catalog-list/,
  )
})
