import assert from 'node:assert/strict'
import test from 'node:test'
import { useAuthStore } from '../../store/authStore.ts'
import {
  applyExternalAuthUser,
  revalidateAuthSessionAgainstServer,
  resetAuthSessionSyncForTests,
} from './authSessionSync.ts'
import {
  bindAuthSessionEpoch,
  captureAuthSession,
  isAuthSessionCurrent,
  resetAuthSessionEpochForTests,
} from './sessionEpoch.ts'
import type { AuthUser } from './types.ts'

const userA: AuthUser = {
  id: 'user-a',
  email: 'a@test.local',
  firstName: 'A',
  lastName: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const userB: AuthUser = {
  id: 'user-b',
  email: 'b@test.local',
  firstName: 'B',
  lastName: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
}

test('applyExternalAuthUser bumps epoch and replaces auth store user', () => {
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  applyExternalAuthUser(userB)

  assert.equal(useAuthStore.getState().user?.id, 'user-b')
  assert.equal(useAuthStore.getState().status, 'authenticated')
  assert.equal(isAuthSessionCurrent(before), false)
  assert.equal(captureAuthSession().userId, 'user-b')
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
})

test('revalidateAuthSessionAgainstServer switches when /me returns other user', async () => {
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  const originalMe = (await import('./authClient.ts')).authClient.me
  ;(await import('./authClient.ts')).authClient.me = async () => userB
  try {
    const result = await revalidateAuthSessionAgainstServer()
    assert.equal(result, 'switched')
    assert.equal(isAuthSessionCurrent(before), false)
    assert.equal(useAuthStore.getState().user?.id, 'user-b')
  } finally {
    ;(await import('./authClient.ts')).authClient.me = originalMe
  }
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
})

test('revalidateAuthSessionAgainstServer logs out when /me is anonymous', async () => {
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  const client = (await import('./authClient.ts')).authClient
  const originalMe = client.me
  client.me = async () => null
  try {
    const result = await revalidateAuthSessionAgainstServer()
    assert.equal(result, 'logged_out')
    assert.equal(isAuthSessionCurrent(before), false)
    assert.equal(useAuthStore.getState().status, 'anonymous')
    assert.equal(useAuthStore.getState().user, null)
  } finally {
    client.me = originalMe
  }
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
})
