import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultGestureConfig } from '../config/gestureConfig.ts'
import type { GestureConfig } from '../types/gesture.ts'
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

test('needsSwipeInboxEnsure allows liked-but-unsorted tracks', () => {
  assert.equal(needsSwipeInboxEnsure(null), true)
  assert.equal(needsSwipeInboxEnsure({ catalogIds: [] }), true)
  assert.equal(needsSwipeInboxEnsure({ catalogIds: ['sys_swipes'] }), false)
  assert.equal(needsSwipeInboxEnsure({ catalogIds: ['cat_party'] }), false)
  assert.equal(
    needsSwipeInboxEnsure({ catalogIds: ['sys_swipes', 'cat_party'] }),
    false,
  )
})

test('canFullscreenLike allows inbox ensure for already liked unsorted', () => {
  assert.equal(
    canFullscreenLike({
      actionTrack: track('a'),
      liked: true,
      likeBusy: false,
      allowInboxEnsure: true,
    }),
    true,
  )
  assert.equal(
    canFullscreenLike({
      actionTrack: track('a'),
      liked: true,
      likeBusy: false,
      allowInboxEnsure: false,
    }),
    false,
  )
  assert.equal(
    canFullscreenLike({
      actionTrack: track('a'),
      liked: true,
      likeBusy: true,
      allowInboxEnsure: true,
    }),
    false,
  )
})

test('favorites gesture hint follows gestureConfig labels', () => {
  const custom: GestureConfig = {
    left: 'skip',
    right: 'like',
    up: 'previous',
    down: 'categorize',
  }
  const hint = formatFavoritesGestureHint(custom)
  assert.match(hint, /← Дальше/)
  assert.match(hint, /→ Лайк/)
  assert.match(hint, /↑ Назад/)
  assert.match(hint, /↓ Каталог/)
  assert.match(hint, /Зеркало источника не меняется/)

  const defaults = formatFavoritesGestureHint(defaultGestureConfig)
  assert.match(defaults, /← Лайк/)
  assert.match(defaults, /→ Каталог/)
  assert.match(defaults, /↑ Дальше/)
  assert.match(defaults, /↓ Назад/)
})

test('favorites like notice only after confirmed save', () => {
  assert.deepEqual(
    resolveFavoritesLikeNotice({
      savedOk: true,
      saveFailedMessage: 'FAIL',
    }),
    {
      kind: 'success',
      message:
        'Добавлено в «Свайпы». В Избранном источника трек остаётся.',
    },
  )
  assert.deepEqual(
    resolveFavoritesLikeNotice({
      savedOk: false,
      saveFailedMessage: 'FAIL',
    }),
    { kind: 'error', message: 'FAIL' },
  )
})
