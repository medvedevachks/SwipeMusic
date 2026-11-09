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
  createCatalogRemoveBusyState,
  getCatalogRemoveContext,
  switchCatalogRemoveBusyState,
  type CatalogRemoveBusyState,
  type CatalogRemoveContext,
} from './catalogDetailRemoveBusy.ts'

const FAIL = 'Не удалось убрать из каталога — можно повторить.'
const TRACK = 'canonical-shared'

function idsOf(state: CatalogRemoveBusyState): string[] {
  return [...state.busyIds].sort()
}

/** Симулятор UI-контекста CatalogDetail без React. */
function createRemoveUi(catalogId: string) {
  let state = createCatalogRemoveBusyState(catalogId)
  let mounted = true
  const busyIdsRef = new Set<string>()
  let contextRef: CatalogRemoveContext = getCatalogRemoveContext(state)

  function syncFromState(next: CatalogRemoveBusyState) {
    state = next
    contextRef = getCatalogRemoveContext(next)
    busyIdsRef.clear()
    for (const id of next.busyIds) {
      busyIdsRef.add(id)
    }
  }

  return {
    get state() {
      return state
    },
    get busyRef() {
      return new Set(busyIdsRef)
    },
    navigateTo(nextCatalogId: string) {
      const next = switchCatalogRemoveBusyState(state, nextCatalogId)
      syncFromState(next)
    },
    unmount() {
      mounted = false
      busyIdsRef.clear()
    },
    start(canonicalTrackId: string) {
      if (busyIdsRef.has(canonicalTrackId)) {
        return null
      }
      const contextAtStart = contextRef
      const started = beginCatalogTrackRemove(
        {
          ...contextAtStart,
          busyIds: new Set(busyIdsRef),
          error: state.error,
        },
        canonicalTrackId,
      )
      if (!started.started) {
        return null
      }
      syncFromState(started.state)
      const sessionAtStart = captureAuthSession()
      return {
        contextAtStart,
        sessionAtStart,
        complete(ok: boolean) {
          const next = applyCatalogRemoveResult(state, {
            canonicalTrackId,
            ok,
            mounted,
            sessionAtStart,
            contextAtStart,
            failureMessage: FAIL,
          })
          if (next !== state) {
            syncFromState(next)
          }
          return next
        },
      }
    },
  }
}

test('CatalogDetail wires catalog context isolation for remove callbacks', () => {
  const source = readFileSync(new URL('./CatalogDetail.tsx', import.meta.url), 'utf8')
  assert.match(source, /removeCanonicalFromCatalog/)
  assert.match(source, /beginCatalogTrackRemove/)
  assert.match(source, /applyCatalogRemoveResult/)
  assert.match(source, /switchCatalogRemoveBusyState/)
  assert.match(source, /contextAtStart/)
  assert.match(source, /flightKey/)
  assert.match(source, /switchCatalogRemoveBusyState/)
  assert.match(source, /captureAuthSession/)
  assert.match(source, /Не удалось убрать из каталога/)
  assert.match(source, /disabled=\{trackRemoveBusy\}/)
  assert.equal(source.includes('setRemoveBusy(createEmptyCatalogRemoveBusyState())'), false)
  assert.equal(/\bremoveBusyId\b/.test(source), false)
  assert.equal(/\bremoveBusyRef\b/.test(source), false)
  assert.equal(/\bremoveContextRef\b/.test(source), false)
})

test('A and B can be busy at the same time', () => {
  let state = createCatalogRemoveBusyState('cat-1')
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  assert.deepEqual(idsOf(state), ['A', 'B'])
})

test('finish A earlier than B leaves B busy', () => {
  let state = createCatalogRemoveBusyState('cat-1')
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const ctx = getCatalogRemoveContext(state)
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    contextAtStart: ctx,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['B'])
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    contextAtStart: ctx,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), [])
})

test('finish B earlier than A leaves A busy', () => {
  let state = createCatalogRemoveBusyState('cat-1')
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const ctx = getCatalogRemoveContext(state)
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'B',
    ok: true,
    mounted: true,
    sessionAtStart: session,
    contextAtStart: ctx,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['A'])
})

test('repeat click on A while busy is ignored', () => {
  let state = createCatalogRemoveBusyState('cat-1')
  const first = beginCatalogTrackRemove(state, 'A')
  assert.equal(first.started, true)
  state = first.state
  const second = beginCatalogTrackRemove(state, 'A')
  assert.equal(second.started, false)
  assert.equal(second.state, state)
})

test('error on A with success on B: A becomes clickable again, B stays busy until done', () => {
  let state = createCatalogRemoveBusyState('cat-1')
  state = beginCatalogTrackRemove(state, 'A').state
  state = beginCatalogTrackRemove(state, 'B').state
  const ctx = getCatalogRemoveContext(state)
  const session = captureAuthSession()
  state = applyCatalogRemoveResult(state, {
    canonicalTrackId: 'A',
    ok: false,
    mounted: true,
    sessionAtStart: session,
    contextAtStart: ctx,
    failureMessage: FAIL,
  })
  assert.deepEqual(idsOf(state), ['B'])
  assert.equal(state.error, FAIL)
  const retryA = beginCatalogTrackRemove(state, 'A')
  assert.equal(retryA.started, true)
  assert.deepEqual(idsOf(retryA.state), ['A', 'B'])
})

test('A → B during DELETE: stale A does not clear shared track busy in B', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  const ui = createRemoveUi('catalog-A')
  const opA = ui.start(TRACK)
  assert.ok(opA)
  assert.deepEqual(idsOf(ui.state), [TRACK])

  ui.navigateTo('catalog-B')
  assert.equal(ui.state.catalogId, 'catalog-B')
  assert.equal(ui.state.generation, 1)
  assert.deepEqual(idsOf(ui.state), [])
  assert.equal(ui.state.error, null)

  const opB = ui.start(TRACK)
  assert.ok(opB)
  assert.deepEqual(idsOf(ui.state), [TRACK])
  assert.deepEqual([...ui.busyRef], [TRACK])

  // Старый A завершается после старта B с тем же canonicalTrackId.
  const afterStaleA = opA.complete(false)
  assert.equal(afterStaleA, ui.state)
  assert.deepEqual(idsOf(ui.state), [TRACK])
  assert.equal(ui.state.error, null)
  assert.deepEqual([...ui.busyRef], [TRACK])

  opB.complete(true)
  assert.deepEqual(idsOf(ui.state), [])
  assert.equal(ui.state.error, null)
  resetAuthSessionEpochForTests()
})

test('A → B during DELETE: completion order B then stale A keeps B stable', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  const ui = createRemoveUi('catalog-A')
  const opA = ui.start(TRACK)
  assert.ok(opA)

  ui.navigateTo('catalog-B')
  const opB = ui.start(TRACK)
  assert.ok(opB)

  opB.complete(false)
  assert.deepEqual(idsOf(ui.state), [])
  assert.equal(ui.state.error, FAIL)

  const beforeStale = ui.state
  const afterStaleA = opA.complete(true)
  assert.equal(afterStaleA, beforeStale)
  assert.equal(ui.state.error, FAIL)
  assert.deepEqual(idsOf(ui.state), [])
  resetAuthSessionEpochForTests()
})

test('stale A success after B start does not clear B busy or write success side-effects', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  const ui = createRemoveUi('catalog-A')
  const opA = ui.start(TRACK)
  assert.ok(opA)
  ui.navigateTo('catalog-B')
  const opB = ui.start(TRACK)
  assert.ok(opB)

  opA.complete(true)
  assert.deepEqual(idsOf(ui.state), [TRACK])
  assert.equal(ui.state.error, null)
  assert.equal(ui.state.catalogId, 'catalog-B')

  opB.complete(true)
  assert.deepEqual(idsOf(ui.state), [])
  resetAuthSessionEpochForTests()
})

test('account switch during DELETE does not apply stale error', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  const ui = createRemoveUi('catalog-A')
  const op = ui.start('A')
  assert.ok(op)
  bindAuthSessionEpoch('user-2')
  const before = ui.state
  const after = op.complete(false)
  assert.equal(after, before)
  assert.deepEqual(idsOf(ui.state), ['A'])
  assert.equal(ui.state.error, null)
  resetAuthSessionEpochForTests()
})

test('unmount during request does not update error for new context', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-1')
  const ui = createRemoveUi('catalog-A')
  const op = ui.start('A')
  assert.ok(op)
  ui.unmount()
  // Новый экран: свежий пустой state (как после remount).
  const fresh = createCatalogRemoveBusyState('catalog-B')
  const next = applyCatalogRemoveResult(fresh, {
    canonicalTrackId: 'A',
    ok: false,
    mounted: false,
    sessionAtStart: op.sessionAtStart,
    contextAtStart: op.contextAtStart,
    failureMessage: FAIL,
  })
  assert.equal(next, fresh)
  assert.equal(next.error, null)
  assert.deepEqual(idsOf(next), [])
  resetAuthSessionEpochForTests()
})

test('ordinary concurrent DELETE of different tracks still works after context switch API', () => {
  const ui = createRemoveUi('catalog-A')
  const opA = ui.start('track-1')
  const opB = ui.start('track-2')
  assert.ok(opA)
  assert.ok(opB)
  assert.deepEqual(idsOf(ui.state), ['track-1', 'track-2'])
  opA.complete(true)
  assert.deepEqual(idsOf(ui.state), ['track-2'])
  opB.complete(false)
  assert.deepEqual(idsOf(ui.state), [])
  assert.equal(ui.state.error, FAIL)
})
