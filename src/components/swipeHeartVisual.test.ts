import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SWIPE_HEART_DISMISS_MS,
  SWIPE_HEART_SIZE_PX,
  prefersReducedMotion,
  resolveSwipeHeartPhase,
  shouldShowSwipeHeart,
} from './swipeHeartVisual.ts'

test('resolveSwipeHeartPhase: fly by default, rest when reduced motion', () => {
  assert.equal(resolveSwipeHeartPhase(false), 'fly')
  assert.equal(resolveSwipeHeartPhase(true), 'rest')
})

test('shouldShowSwipeHeart only when saved and auth current', () => {
  assert.equal(
    shouldShowSwipeHeart({ savedOk: true, authCurrent: true }),
    true,
  )
  assert.equal(
    shouldShowSwipeHeart({ savedOk: false, authCurrent: true }),
    false,
  )
  assert.equal(
    shouldShowSwipeHeart({ savedOk: true, authCurrent: false }),
    false,
  )
})

test('prefersReducedMotion reads matchMedia reduce query', () => {
  assert.equal(
    prefersReducedMotion(() => ({ matches: true }) as MediaQueryList),
    true,
  )
  assert.equal(
    prefersReducedMotion(() => ({ matches: false }) as MediaQueryList),
    false,
  )
  assert.equal(prefersReducedMotion(undefined), false)
})

test('SwipeHeartBurst reuses SwipeDeck heart CSS and size', () => {
  const burst = readFileSync(
    new URL('./SwipeHeartBurst.tsx', import.meta.url),
    'utf8',
  )
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(burst, /swipe-heart-fly/)
  assert.match(burst, /swipe-heart-rest/)
  assert.match(burst, /data-heart=\{phase\}/)
  assert.match(burst, /data-heart-size=\{String\(SWIPE_HEART_SIZE_PX\)\}/)
  assert.equal(SWIPE_HEART_SIZE_PX, 152)
  assert.match(css, /\.swipe-heart\s*\{/)
  assert.match(css, /@keyframes swipe-heart-fly/)
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.equal(SWIPE_HEART_DISMISS_MS, 1100)
})

test('FullscreenPlayer shows heart only after saved===true', () => {
  const source = readFileSync(
    new URL('./player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /SwipeHeartBurst/)
  assert.match(source, /shouldShowSwipeHeart/)
  assert.match(source, /resolveSwipeHeartPhase/)
  assert.match(source, /isAuthSessionCurrent/)
  assert.match(source, /data-testid="fullscreen-player-like-heart"/)
  assert.match(source, /classifySwipeTrack/)
  // Save path stays on classifySwipeTrack — no parallel like/save helper.
  assert.equal(source.includes('likeSourceTrack('), false)
})
