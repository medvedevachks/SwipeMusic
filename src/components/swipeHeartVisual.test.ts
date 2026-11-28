import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SWIPE_HEART_DISMISS_MS,
  SWIPE_HEART_REST_DISMISS_MS,
  SWIPE_HEART_SIZE_PX,
  createTrackLikeInFlightGate,
  prefersReducedMotion,
  resolveFullscreenLikeAsyncError,
  resolveFullscreenLikeAsyncUi,
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

test('double-like: same track blocked while in flight, other track allowed', () => {
  const gate = createTrackLikeInFlightGate()
  assert.equal(gate.tryBegin('a'), true)
  assert.equal(gate.tryBegin('a'), false)
  assert.equal(gate.has('a'), true)
  assert.equal(gate.tryBegin('b'), true)
  assert.equal(gate.has('b'), true)
  gate.end('a')
  assert.equal(gate.has('a'), false)
  assert.equal(gate.tryBegin('a'), true)
  gate.end('b')
  gate.end('a')
})

test('async UI: successful animation only when saved+auth+current track', () => {
  const success = resolveFullscreenLikeAsyncUi({
    savedOk: true,
    authCurrent: true,
    trackStillCurrent: true,
    tokenCurrent: true,
    favoritesMode: true,
    reduceMotion: false,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(success, {
    kind: 'success',
    notice: 'OK',
    heartPhase: 'fly',
    dismissMs: SWIPE_HEART_DISMISS_MS,
  })

  const reduced = resolveFullscreenLikeAsyncUi({
    savedOk: true,
    authCurrent: true,
    trackStillCurrent: true,
    tokenCurrent: true,
    favoritesMode: true,
    reduceMotion: true,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.equal(reduced.kind, 'success')
  if (reduced.kind === 'success') {
    assert.equal(reduced.heartPhase, 'rest')
    assert.equal(reduced.dismissMs, SWIPE_HEART_REST_DISMISS_MS)
  }
})

test('async UI: logout during save ignores notice and heart', () => {
  const ui = resolveFullscreenLikeAsyncUi({
    savedOk: true,
    authCurrent: false,
    trackStillCurrent: true,
    tokenCurrent: true,
    favoritesMode: true,
    reduceMotion: false,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(ui, { kind: 'ignore' })

  const failedLogout = resolveFullscreenLikeAsyncError({
    authCurrent: false,
    trackStillCurrent: true,
    tokenCurrent: true,
    favoritesMode: true,
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(failedLogout, { kind: 'ignore' })
})

test('async UI: track change during save ignores notice and heart', () => {
  const ui = resolveFullscreenLikeAsyncUi({
    savedOk: true,
    authCurrent: true,
    trackStillCurrent: false,
    tokenCurrent: true,
    favoritesMode: true,
    reduceMotion: false,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(ui, { kind: 'ignore' })
})

test('async UI: save failure shows error notice without heart', () => {
  const ui = resolveFullscreenLikeAsyncUi({
    savedOk: false,
    authCurrent: true,
    trackStillCurrent: true,
    tokenCurrent: true,
    favoritesMode: true,
    reduceMotion: false,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(ui, { kind: 'error', notice: 'FAIL' })
})

test('async UI: stale token ignores result', () => {
  const ui = resolveFullscreenLikeAsyncUi({
    savedOk: true,
    authCurrent: true,
    trackStillCurrent: true,
    tokenCurrent: false,
    favoritesMode: true,
    reduceMotion: false,
    successNotice: 'OK',
    saveFailedMessage: 'FAIL',
  })
  assert.deepEqual(ui, { kind: 'ignore' })
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

test('FullscreenPlayer wires per-track in-flight gate and auth-first async UI', () => {
  const source = readFileSync(
    new URL('./player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /SwipeHeartBurst/)
  assert.match(source, /createTrackLikeInFlightGate/)
  assert.match(source, /likeInFlightGateRef\.current\.tryBegin/)
  assert.match(source, /resolveFullscreenLikeAsyncUi/)
  assert.match(source, /resolveFullscreenLikeAsyncError/)
  assert.match(source, /isAuthSessionCurrent\(likeSession\)/)
  assert.match(source, /likeInFlightTrackId === actionTrack\.id/)
  assert.match(source, /data-testid="fullscreen-player-like-heart"/)
  assert.match(source, /classifySwipeTrack/)
  assert.equal(source.includes('likeSourceTrack('), false)
  // Global likeBusy no longer held across await.
  assert.equal(source.includes('setLikeBusy(true)'), false)
  assert.equal(source.includes('setLikeBusy(false)'), false)
})
