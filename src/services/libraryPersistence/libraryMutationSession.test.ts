import assert from 'node:assert/strict'
import test from 'node:test'
import { useAuthStore } from '../../store/authStore.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError } from './client.ts'
import {
  resetLibraryMutationQueuesForTests,
  runLibraryMutation,
} from './mutations.ts'
import {
  SAVE_FAILED_MESSAGE,
  useLibraryPersistenceStore,
} from './statusStore.ts'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function reset(): void {
  resetAuthSessionEpochForTests()
  resetLibraryMutationQueuesForTests()
  useAuthStore.setState({
    user: { id: 'user-b', email: 'b@test' } as never,
    status: 'authenticated',
  })
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
}

test('stale HTTP 500 after logout does not SAVE_FAILED for B', async () => {
  reset()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  const gate = deferred<boolean>()
  const pending = runLibraryMutation(async () => {
    await gate.promise
    throw new LibraryHttpError(500)
  })

  bindAuthSessionEpoch('user-b')
  useAuthStore.setState({
    user: { id: 'user-b', email: 'b@test' } as never,
    status: 'authenticated',
  })
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'saving',
    message: null,
  })

  gate.resolve(true)
  assert.equal(await pending, null)
  assert.equal(useAuthStore.getState().status, 'authenticated')
  assert.equal(useAuthStore.getState().user?.id, 'user-b')
  assert.notEqual(
    useLibraryPersistenceStore.getState().message,
    SAVE_FAILED_MESSAGE,
  )
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')
})

test('stale HTTP 401 after logout does not anonymous B', async () => {
  reset()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  const gate = deferred<boolean>()
  const pending = runLibraryMutation(async () => {
    await gate.promise
    throw new LibraryHttpError(401)
  })

  bindAuthSessionEpoch('user-b')
  useAuthStore.setState({
    user: { id: 'user-b', email: 'b@test' } as never,
    status: 'authenticated',
  })
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'saving',
    message: null,
  })

  gate.resolve(true)
  assert.equal(await pending, null)
  assert.equal(useAuthStore.getState().status, 'authenticated')
  assert.equal(useAuthStore.getState().user?.id, 'user-b')
  assert.equal(useLibraryPersistenceStore.getState().armed, true)
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')
})

test('stale finally does not clear B saving when A was last pending count', async () => {
  reset()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  const gate = deferred<'ok'>()
  const pendingA = runLibraryMutation(async () => {
    await gate.promise
    return 'ok' as const
  })

  bindAuthSessionEpoch('user-b')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'saving',
    message: null,
  })

  gate.resolve('ok')
  assert.equal(await pendingA, null)
  // A finally не должен перевести saving → ready за B.
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')
})

test('A hung save then B completes to ready; late A does not deadlock saving', async () => {
  reset()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  const gateA = deferred<'a'>()
  const pendingA = runLibraryMutation(async () => {
    await gateA.promise
    return 'a' as const
  })
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')

  bindAuthSessionEpoch('user-b')
  useAuthStore.setState({
    user: { id: 'user-b', email: 'b@test' } as never,
    status: 'authenticated',
  })
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })

  const resultB = await runLibraryMutation(async () => 'b' as const)
  assert.equal(resultB, 'b')
  assert.equal(useLibraryPersistenceStore.getState().status, 'ready')
  assert.equal(useLibraryPersistenceStore.getState().message, null)

  gateA.resolve('a')
  assert.equal(await pendingA, null)
  assert.equal(useLibraryPersistenceStore.getState().status, 'ready')
  assert.equal(useAuthStore.getState().user?.id, 'user-b')
  assert.notEqual(
    useLibraryPersistenceStore.getState().message,
    SAVE_FAILED_MESSAGE,
  )
})

test('A completes after B while B still has parallel saves; B reaches ready', async () => {
  reset()
  bindAuthSessionEpoch('user-a')
  const gateA = deferred<'a'>()
  const pendingA = runLibraryMutation(async () => {
    await gateA.promise
    return 'a' as const
  })

  bindAuthSessionEpoch('user-b')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  const gateB1 = deferred<'b1'>()
  const gateB2 = deferred<'b2'>()
  const pendingB1 = runLibraryMutation(async () => {
    await gateB1.promise
    return 'b1' as const
  })
  const pendingB2 = runLibraryMutation(async () => {
    await gateB2.promise
    return 'b2' as const
  })
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')

  gateA.resolve('a')
  assert.equal(await pendingA, null)
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')

  gateB1.resolve('b1')
  assert.equal(await pendingB1, 'b1')
  assert.equal(useLibraryPersistenceStore.getState().status, 'saving')

  gateB2.resolve('b2')
  assert.equal(await pendingB2, 'b2')
  assert.equal(useLibraryPersistenceStore.getState().status, 'ready')
})
