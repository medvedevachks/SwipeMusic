import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { defaultGestureConfig } from '../config/gestureConfig.ts'
import {
  SYS_FAVORITES_PLAYLIST_ID,
  isFavoritesPlayback,
  isUserCatalogPlayback,
} from './catalogFullscreen.ts'
import {
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

test('FAV-02 gesture hint is driven by gestureConfig', () => {
  const hint = formatFavoritesGestureHint({
    ...defaultGestureConfig,
    left: 'categorize',
    right: 'skip',
  })
  assert.match(hint, /← Каталог/)
  assert.match(hint, /→ Дальше/)
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
  assert.match(source, /pointer:\s*\{\s*touch:\s*true\s*\}/)
  assert.match(source, /eventOptions:\s*\{\s*passive:\s*false\s*\}/)
  assert.equal(source.includes('new AudioPlayer'), false)
})

test('FAV-02 FullscreenPlayer favorites gestures cover touch and mouse paths', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /bindFavoritesGesture\s*=\s*useDrag/)
  assert.match(source, /pointer:\s*\{\s*touch:\s*true\s*\}/)
  assert.match(source, /pointer\/touch \+ mouse/)
  assert.match(source, /applyFavoritesGesture/)
  assert.match(source, /void next\(\)/)
  assert.match(source, /void previous\(\)/)
  assert.match(source, /data-testid="fullscreen-player-favorites-gesture"/)
  // Кнопки Next/Previous остаются доступны мышью рядом с жестами на обложке.
  assert.match(source, /aria-label="Предыдущий"/)
  assert.match(source, /aria-label="Следующий"/)
})
