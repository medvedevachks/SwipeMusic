import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SYS_FAVORITES_PLAYLIST_ID,
  isFavoritesPlayback,
  isUserCatalogPlayback,
} from './catalogFullscreen.ts'
import {
  FAVORITES_PLAYER_GESTURE_CONFIG,
  formatFavoritesGestureHint,
  needsSwipeInboxEnsure,
  resolveFavoritesLikeNotice,
} from './favoritesPlayerActions.ts'
import { canFullscreenLike } from './fullscreenPlayerActions.ts'
import type { Track } from '../types/track.ts'

function track(id: string): Track {
  return {
    id,
    sourceId: 'yandex-music',
    externalId: id,
    title: id,
    artist: 'A',
  }
}

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

test('FAV-02 like gate and inbox ensure behaviour', () => {
  assert.equal(needsSwipeInboxEnsure({ catalogIds: [] }), true)
  assert.equal(needsSwipeInboxEnsure({ catalogIds: ['sys_swipes'] }), false)
  assert.equal(
    canFullscreenLike({
      actionTrack: track('a'),
      liked: true,
      likeBusy: false,
      allowInboxEnsure: true,
    }),
    true,
  )
  const notice = resolveFavoritesLikeNotice({
    savedOk: true,
    saveFailedMessage: 'FAIL',
  })
  assert.equal(notice.kind, 'success')
  assert.match(notice.message, /Свайпы/)
})

test('FAV-02 favorites player uses fixed swipe mapping', () => {
  assert.deepEqual(FAVORITES_PLAYER_GESTURE_CONFIG, {
    left: 'like',
    right: 'categorize',
    up: 'skip',
    down: 'previous',
  })
  const hint = formatFavoritesGestureHint()
  assert.match(hint, /← Свайпы/)
  assert.match(hint, /→ Категория/)
  assert.match(hint, /↑ Дальше/)
  assert.match(hint, /↓ Назад/)
})

test('LibraryFolder favorites wires early fullscreen accept path', () => {
  const source = readFileSync(
    new URL('../pages/LibraryFolder.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /onPlaybackAccepted/)
  assert.match(source, /openFavoritesFullscreenIfCurrent/)
  assert.match(source, /openFullscreenPlayer/)
  assert.match(source, /startSwipeInboxSorting/)
})

test('FullscreenPlayer favorites like waits for save confirmation', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /resolveFavoritesLikeNotice/)
  assert.match(source, /needsSwipeInboxEnsure/)
  assert.match(source, /formatFavoritesGestureHint/)
  assert.match(source, /preventScroll:\s*false/)
  assert.match(source, /filterTaps:\s*false/)
  assert.equal(source.includes('new AudioPlayer'), false)
})

test('FAV-02 FullscreenPlayer favorites gestures cover touch and mouse paths', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /bindFavoritesGesture\s*=\s*useDrag/)
  assert.match(source, /preventScroll:\s*false/)
  assert.match(source, /filterTaps:\s*false/)
  assert.match(source, /FAVORITES_PLAYER_GESTURE_CONFIG/)
  assert.match(source, /applyFavoritesGesture/)
  assert.match(source, /dragOffset/)
  assert.match(source, /fullscreen-player-swipe-card/)
  assert.match(source, /void next\(\)/)
  assert.match(source, /void previous\(\)/)
  assert.match(source, /data-testid="fullscreen-player-favorites-gesture"/)
  assert.match(source, /aria-label="Предыдущий"/)
  assert.match(source, /aria-label="Следующий"/)
})

test('FAV-02 artwork size is reduced for portrait without breaking landscape hooks', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /width:\s*min\(100%,\s*18rem\)/)
  assert.match(css, /max-height:\s*min\(42svh,\s*18rem\)/)
  assert.equal(/22rem/.test(css.match(/\.fullscreen-player-art\s*\{[^}]+\}/)?.[0] ?? ''), false)
  assert.match(css, /fullscreen-player-swipe-card--gestures/)
  assert.match(css, /touch-action:\s*none/)
  assert.match(css, /grid-area:\s*card/)
})
