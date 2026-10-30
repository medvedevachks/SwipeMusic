import assert from 'node:assert/strict'
import test from 'node:test'
import { useAuthStore } from '../../store/authStore.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError } from './client.ts'
import { runLibraryMutation } from './mutations.ts'
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
  useAuthStore.setState({ user: { id: 'user-b', email: 'b@test' } as never, status: 'authenticated' })
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
