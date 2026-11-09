import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  bindAuthSessionEpoch,
  captureAuthSession,
  resetAuthSessionEpochForTests,
} from '../services/auth/sessionEpoch.ts'
import {
  applyCatalogRemoveResult,
  beginCatalogTrackRemove,
  createEmptyCatalogRemoveBusyState,
  type CatalogRemoveBusyState,
} from './catalogDetailRemoveBusy.ts'

const FAIL = 'Не удалось убрать из каталога — можно повторить.'

function idsOf(state: CatalogRemoveBusyState): string[] {
  return [...state.busyIds].sort()
}

test('CatalogDetail wires Set-based remove busy with session/mount gates', () => {
  const source = readFileSync(new URL('./CatalogDetail.tsx', import.meta.url), 'utf8')
  assert.match(source, /removeCanonicalFromCatalog/)
  assert.match(source, /beginCatalogTrackRemove/)
  assert.match(source, /applyCatalogRemoveResult/)
  assert.match(source, /removeBusyIdsRef/)
  assert.match(source, /captureAuthSession/)
  assert.match(source, /removeMountedRef/)
  assert.match(source, /Не удалось убрать из каталога/)
  assert.match(source, /disabled=\{trackRemoveBusy\}/)
  assert.equal(/\bremoveBusyId\b/.test(source), false)
  assert.equal(/\bremoveBusyRef\b/.test(source), false)
  assert.equal(/\bsetRemoveError\b/.test(source), false)
  assert.equal(/\bremoveError\b/.test(source), false)
})

test('A and B can be busy at the same time', () => {
  let state = createEmptyCatalogRemoveBusyState()
  const a = beginCatalogTrackRemove(state, 'A')
  assert.equal(a.started, true)
  state = a.state
  const b = beginCatalogTrackRemove(state, 'B')
  assert.equal(b.started, true)
  state = b.state
  assert.deepEqual(idsOf(state), ['A', 'B'])
  assert.equal(state.error, null)
})

test('finish A earlier than B leaves B busy', () => {
  let state = createEmptyCatalogRemoveBusyState()
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['B'])
  assert.equal(state.error, null)
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), [])
})

test('finish B earlier than A leaves A busy', () => {
  let state = createEmptyCatalogRemoveBusyState()
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['A'])
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), [])
})

test('repeat click on A while busy is ignored', () => {
  let state = createEmptyCatalogRemoveBusyState()
  const first = beginCatalogTrackRemove(state, 'A')
  assert.equal(first.started, true)
  state = first.state
  const second = beginCatalogTrackRemove(state, 'A')
  assert.equal(second.started, false)
  assert.deepEqual(idsOf(second.state), ['A'])
  assert.equal(second.state, state)
})

test('error on A with success on B: A becomes clickable again, B stays busy until done', () => {
  let state = createEmptyCatalogRemoveBusyState()
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: false,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['B'])
  assert.equal(state.error, FAIL)
  const retryA = beginCatalogTrackRemove(state, 'A')
  assert.equal(retryA.started, true)
  state = retryA.state
  assert.deepEqual(idsOf(state), ['A', 'B'])
  assert.equal(state.error, null)
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['A'])
  assert.equal(state.error, null)
})

test('account switch during DELETE does not apply stale error', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  let state = createEmptyCatalogRemoveBusyState()
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const sessionAtStart = captureAuthSession()
  bindAuthSessionEpoch('user-2')
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: false,
    mounted: true,
    sessionAtStart,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['B'])
  assert.equal(state.error, null)
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: false,
    mounted: true,
    sessionAtStart,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), [])
  assert.equal(state.error, null)
  resetAuthSessionEpochForTests()
})

test('leave page during request does not update error for new context', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  let state = createEmptyCatalogRemoveBusyState()
  state = beginCatalogTrackRemove(state, 'A').state
  const sessionAtStart = captureAuthSession()
  // Unmount: UI сбрасывает local state; устаревший then не должен писать error.
  state = createEmptyCatalogRemoveBusyState()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: false,
    mounted: false,
    sessionAtStart,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), [])
  assert.equal(state.error, null)
  resetAuthSessionEpochForTests()
})
