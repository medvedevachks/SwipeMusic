import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SYS_FAVORITES_PLAYLIST_ID,
  isFavoritesPlayback,
  isUserCatalogPlayback,
  shouldOpenFullscreenAfterCatalogPlay,
} from './catalogFullscreen.ts'

test('isFavoritesPlayback detects sys_favorites playlist context', () => {
  assert.equal(
    isFavoritesPlayback({
      context: {
        type: 'playlist',
        id: SYS_FAVORITES_PLAYLIST_ID,
        title: 'Избранное',
      },
      activeSessionId: 'catalog',
    }),
    true,
  )
  assert.equal(
    isFavoritesPlayback({
      context: { type: 'playlist', id: 'cat_a', title: 'Party' },
      activeSessionId: 'catalog',
    }),
    false,
  )
  assert.equal(
    isFavoritesPlayback({
      context: { type: 'playlist', id: 'sys_swipes', title: 'Свайпы' },
      activeSessionId: null,
    }),
    false,
  )
})

test('favorites remains a catalog session for queue UI', () => {
  assert.equal(
    isUserCatalogPlayback({
      context: {
        type: 'playlist',
        id: SYS_FAVORITES_PLAYLIST_ID,
        title: 'Избранное',
      },
      activeSessionId: 'catalog',
    }),
    true,
  )
})

test('LibraryFolder favorites opens fullscreen on early playback intent', () => {
  const source = readFileSync(
    new URL('../pages/LibraryFolder.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /folderId === 'favorites'/)
  assert.match(source, /SYS_FAVORITES_PLAYLIST_ID|sys_favorites/)
  assert.match(source, /openFullscreenPlayer/)
  assert.match(source, /onPlaybackAccepted/)
  assert.match(source, /openFavoritesFullscreenIfCurrent/)
  assert.match(source, /shouldOpenFullscreenAfterCatalogPlay/)
  assert.match(source, /playBusyRef/)
  assert.match(source, /fullscreenOpenedForPlayRef/)
  // Свайпы по-прежнему уходят на Home, не в fullscreen catalog loop.
  assert.match(source, /startSwipeInboxSorting/)
  assert.match(source, /navigate\('\/'\)/)
  assert.equal(shouldOpenFullscreenAfterCatalogPlay({ status: 'played' }), true)
})

test('FullscreenPlayer favorites gestures reuse swipe engine without second AudioPlayer', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /isFavoritesPlayback/)
  assert.match(source, /resolveSwipeAction/)
  assert.match(source, /useDrag/)
  assert.match(source, /fullscreen-player-favorites-gesture/)
  assert.match(source, /classifySwipeTrack/)
  assert.match(source, /В Избранном источника трек остаётся/)
  assert.equal(source.includes('new AudioPlayer'), false)
  assert.equal(source.includes('getAudioPlayer('), false)
  // Список по-прежнему из живой queue store (не копия favorites).
  assert.match(source, /useGlobalPlayerStore\(\(s\) => s\.queue\)/)
  assert.match(source, /playFromQueue/)
})

test('live favorites membership keeps external mirror after local like/categorize filter', () => {
  const live = readFileSync(
    new URL('../services/catalogPlayback/liveCatalogQueue.ts', import.meta.url),
    'utf8',
  )
  assert.match(live, /VIRTUAL_FAVORITES_ID = 'sys_favorites'/)
  assert.match(live, /hasSourceFavorite/)
  assert.equal(live.includes('state.liked'), false)
})
