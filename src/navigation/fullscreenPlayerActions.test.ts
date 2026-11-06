import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Track } from '../types/track.ts'
import {
  canFullscreenLike,
  resolveCatalogCommitTrack,
  resolveFullscreenActionTrack,
  shouldDismissCatalogOnTrackChange,
} from './fullscreenPlayerActions.ts'
import {
  closeFullscreenPlayer,
  openFullscreenPlayer,
  withFullscreenPlayerSearch,
} from './fullscreenPlayer.ts'

function track(id: string, title = id): Track {
  return {
    id,
    sourceId: 'dev-acceptance',
    externalId: id,
    title,
    artist: 'Artist',
  }
}

test('fullscreen actions ignore pendingTrack (not yet audible)', () => {
  assert.equal(
    resolveFullscreenActionTrack({
      currentTrack: track('a'),
      pendingTrack: track('b'),
    }),
    null,
  )
  assert.equal(
    resolveFullscreenActionTrack({
      currentTrack: track('a'),
      pendingTrack: null,
    })?.id,
    'a',
  )
})

test('like gate blocks busy, already-liked and missing track', () => {
  assert.equal(
    canFullscreenLike({ actionTrack: track('a'), liked: false, likeBusy: false }),
    true,
  )
  assert.equal(
    canFullscreenLike({ actionTrack: track('a'), liked: true, likeBusy: false }),
    false,
  )
  assert.equal(
    canFullscreenLike({ actionTrack: track('a'), liked: false, likeBusy: true }),
    false,
  )
  assert.equal(
    canFullscreenLike({ actionTrack: null, liked: false, likeBusy: false }),
    false,
  )
})

test('catalog sheet dismisses when audible track changes', () => {
  assert.equal(
    shouldDismissCatalogOnTrackChange({
      catalogOpen: true,
      pinnedTrackId: 'a',
      currentTrackId: 'b',
    }),
    true,
  )
  assert.equal(
    shouldDismissCatalogOnTrackChange({
      catalogOpen: true,
      pinnedTrackId: 'a',
      currentTrackId: 'a',
    }),
    false,
  )
  assert.equal(
    shouldDismissCatalogOnTrackChange({
      catalogOpen: false,
      pinnedTrackId: 'a',
      currentTrackId: 'b',
    }),
    false,
  )
})

test('catalog commit uses pinned track and rejects mismatched live track', () => {
  const pinned = track('a', 'Pinned')
  assert.equal(
    resolveCatalogCommitTrack({ pinnedTrack: pinned, currentTrack: track('a') })?.title,
    'Pinned',
  )
  assert.equal(
    resolveCatalogCommitTrack({ pinnedTrack: pinned, currentTrack: track('b') }),
    null,
  )
  assert.equal(
    resolveCatalogCommitTrack({ pinnedTrack: null, currentTrack: track('a') }),
    null,
  )
})

test('open fullscreen preserves search query params without duplicating history', () => {
  const calls: unknown[] = []
  const navigate = ((to: unknown, opts?: unknown) => {
    calls.push({ to, opts })
  }) as never

  openFullscreenPlayer(navigate, {
    pathname: '/search',
    search: '?q=%D0%A1%D0%BF%D0%BB%D0%B8%D0%BD',
    hash: '',
    state: null,
  })
  assert.equal(calls.length, 1)
  const first = calls[0] as { to: { search: string } }
  assert.match(first.to.search, /q=/)
  assert.match(first.to.search, /player=full/)

  openFullscreenPlayer(navigate, {
    pathname: '/search',
    search: first.to.search,
    hash: '',
    state: { fullscreenPlayerEntry: true },
  })
  assert.equal(calls.length, 1)
  assert.equal(
    withFullscreenPlayerSearch('?q=test'),
    '?q=test&player=full',
  )
})

test('direct-url close strips player param with replace instead of history.back', () => {
  const calls: unknown[] = []
  const navigate = ((to: unknown, opts?: unknown) => {
    calls.push({ to, opts })
  }) as never
  closeFullscreenPlayer(navigate, {
    pathname: '/wave',
    search: '?player=full',
    hash: '',
    state: null,
  })
  assert.deepEqual(calls[0], {
    to: { pathname: '/wave', search: '', hash: '' },
    opts: { replace: true, state: {} },
  })
})

test('FullscreenPlayer wires race-safe catalog/like and does not own playback engine', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /resolveFullscreenActionTrack/)
  assert.match(source, /shouldDismissCatalogOnTrackChange/)
  assert.match(source, /resolveCatalogCommitTrack/)
  assert.match(source, /classifySwipeTrack/)
  assert.match(source, /commitCatalogChoice/)
  assert.match(source, /mini-player-open-fullscreen/)
  assert.equal(source.includes('switchTo('), false)
  assert.equal(source.includes('new AudioPlayer'), false)
  assert.equal(source.includes('getAudioPlayer('), false)
  // Escape сначала закрывает sheet/menu, затем плеер.
  assert.match(source, /if \(catalogSheetOpen\)/)
  assert.match(source, /if \(menuOpen\)/)
  assert.match(source, /catalogSheetOpen/)
})
