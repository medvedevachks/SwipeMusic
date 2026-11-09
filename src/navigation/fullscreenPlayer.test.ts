import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  closeFullscreenPlayer,
  isFullscreenPlayerSearch,
  openFullscreenPlayer,
  resolvePlayerSessionLabel,
  withFullscreenPlayerSearch,
  withoutFullscreenPlayerSearch,
} from './fullscreenPlayer.ts'

test('fullscreen player search helpers preserve other query params', () => {
  assert.equal(isFullscreenPlayerSearch('?q=splin&player=full'), true)
  assert.equal(isFullscreenPlayerSearch('?q=splin'), false)
  assert.equal(withFullscreenPlayerSearch('?q=splin'), '?q=splin&player=full')
  assert.equal(withoutFullscreenPlayerSearch('?q=splin&player=full'), '?q=splin')
  assert.equal(withoutFullscreenPlayerSearch('?player=full'), '')
})

test('openFullscreenPlayer is idempotent and marks history entry', () => {
  const calls: Array<{ to: unknown; opts: unknown }> = []
  const navigate = ((to: unknown, opts?: unknown) => {
    calls.push({ to, opts })
  }) as never

  openFullscreenPlayer(navigate, {
    pathname: '/library',
    search: '?tab=1',
    hash: '',
    state: { keep: true },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.to, {
    pathname: '/library',
    search: '?tab=1&player=full',
    hash: '',
  })
  assert.deepEqual(calls[0]?.opts, {
    state: { keep: true, fullscreenPlayerEntry: true },
  })

  openFullscreenPlayer(navigate, {
    pathname: '/library',
    search: '?tab=1&player=full',
    hash: '',
    state: { fullscreenPlayerEntry: true },
  })
  assert.equal(calls.length, 1)
})

test('closeFullscreenPlayer uses history back only for marked entries', () => {
  const deltas: number[] = []
  const replaces: unknown[] = []
  const navigate = ((to: unknown, opts?: unknown) => {
    if (typeof to === 'number') {
      deltas.push(to)
      return
    }
    replaces.push({ to, opts })
  }) as never

  closeFullscreenPlayer(navigate, {
    pathname: '/search',
    search: '?player=full',
    hash: '',
    state: { fullscreenPlayerEntry: true },
  })
  assert.deepEqual(deltas, [-1])
  assert.equal(replaces.length, 0)

  closeFullscreenPlayer(navigate, {
    pathname: '/search',
    search: '?q=a&player=full',
    hash: '',
    state: null,
  })
  assert.equal(deltas.length, 1)
  assert.deepEqual(replaces[0], {
    to: { pathname: '/search', search: '?q=a', hash: '' },
    opts: { replace: true, state: {} },
  })
})

test('session label prefers SessionSwitch id over UI screen context', () => {
  assert.equal(
    resolvePlayerSessionLabel({
      context: { type: 'playlist', id: 'cat_x', title: 'X' },
      activeSessionId: 'wave',
    }),
    'Моя волна',
  )
  assert.equal(
    resolvePlayerSessionLabel({
      context: { type: 'search-seed', query: 'q', seedTrackId: 't1' },
      activeSessionId: null,
    }),
    'Поиск',
  )
  assert.equal(
    resolvePlayerSessionLabel({
      context: { type: 'album', id: 'a', title: 'A' },
      activeSessionId: 'album',
    }),
    'Альбом',
  )
})

test('BottomPlayer opens fullscreen overlay instead of linking meta to /queue', () => {
  const bottom = readFileSync(new URL('../components/player/BottomPlayer.tsx', import.meta.url), 'utf8')
  const layout = readFileSync(new URL('../layouts/MainLayout.tsx', import.meta.url), 'utf8')
  assert.match(bottom, /mini-player-open-fullscreen/)
  assert.match(bottom, /openFullscreen/)
  assert.equal(bottom.includes('<Link\n            to="/queue"\n            className="player-meta'), false)
  assert.match(bottom, /to="\/queue"/)
  assert.match(layout, /FullscreenPlayer/)
  assert.ok(layout.indexOf('<BottomPlayer') < layout.indexOf('<FullscreenPlayer'))
})

test('FullscreenPlayer consumes playerStore and does not construct AudioPlayer', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /useGlobalPlayerStore/)
  assert.match(source, /classifySwipeTrack/)
  assert.match(source, /commitCatalogChoice/)
  assert.match(source, /removeSortedCanonicalFromSwipesQueue/)
  assert.match(source, /resolvePlayerSessionLabel/)
  assert.equal(source.includes('new AudioPlayer'), false)
  assert.equal(source.includes('getAudioPlayer('), false)
  assert.match(source, /data-testid="fullscreen-player"/)
})
