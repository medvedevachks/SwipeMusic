import assert from 'node:assert/strict'
import test from 'node:test'
import { useAuthStore } from '../../store/authStore.ts'
import {
  applyExternalAuthUser,
  revalidateAuthSessionAgainstServer,
  resetAuthSessionSyncForTests,
} from './authSessionSync.ts'
import { authClient } from './authClient.ts'
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

function resetAll(): void {
  resetAuthSessionEpochForTests()
  resetAuthSessionSyncForTests()
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for ${label}`)
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('applyExternalAuthUser bumps epoch and replaces auth store user', () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  applyExternalAuthUser(userB)

  assert.equal(useAuthStore.getState().user?.id, 'user-b')
  assert.equal(useAuthStore.getState().status, 'authenticated')
  assert.equal(isAuthSessionCurrent(before), false)
  assert.equal(captureAuthSession().userId, 'user-b')
  resetAll()
})

test('revalidateAuthSessionAgainstServer switches when /me returns other user', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  const originalMe = authClient.me
  authClient.me = async () => userB
  try {
    const result = await revalidateAuthSessionAgainstServer()
    assert.equal(result, 'switched')
    assert.equal(isAuthSessionCurrent(before), false)
    assert.equal(useAuthStore.getState().user?.id, 'user-b')
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('revalidateAuthSessionAgainstServer logs out when /me is anonymous', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  const originalMe = authClient.me
  authClient.me = async () => null
  try {
    const result = await revalidateAuthSessionAgainstServer()
    assert.equal(result, 'logged_out')
    assert.equal(isAuthSessionCurrent(before), false)
    assert.equal(useAuthStore.getState().status, 'anonymous')
    assert.equal(useAuthStore.getState().user, null)
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('HOTFIX-01 A: stale /me(A) after local login(B) does not overwrite B', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const genBeforeLogin = captureAuthSession()

  let resolveMe!: (user: AuthUser | null) => void
  let meCalls = 0
  const originalMe = authClient.me
  authClient.me = () => {
    meCalls += 1
    if (meCalls === 1) {
      return new Promise<AuthUser | null>((resolve) => {
        resolveMe = resolve
      })
    }
    // follow-up after stale: cookie already B
    return Promise.resolve(userB)
  }

  try {
    const pending = revalidateAuthSessionAgainstServer()

    // Локальный login B пока /me в полёте
    bindAuthSessionEpoch('user-b')
    useAuthStore.setState({ user: userB, status: 'authenticated' })
    const afterLogin = captureAuthSession()
    assert.equal(isAuthSessionCurrent(genBeforeLogin), false)

    resolveMe(userA)
    const result = await pending
    assert.equal(result, 'unchanged')
    assert.equal(useAuthStore.getState().user?.id, 'user-b')
    assert.equal(useAuthStore.getState().status, 'authenticated')
    assert.equal(isAuthSessionCurrent(afterLogin), true)

    await waitFor(() => meCalls >= 2, 'follow-up /me after stale A→B')
    await waitFor(
      () => useAuthStore.getState().user?.id === 'user-b',
      'store stays B after follow-up',
    )
    assert.equal(captureAuthSession().userId, 'user-b')
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('HOTFIX-01 B: stale /me(A) after local logout stays anonymous', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })

  let resolveMe!: (user: AuthUser | null) => void
  let meCalls = 0
  const originalMe = authClient.me
  authClient.me = () => {
    meCalls += 1
    if (meCalls === 1) {
      return new Promise<AuthUser | null>((resolve) => {
        resolveMe = resolve
      })
    }
    return Promise.resolve(null)
  }

  try {
    const pending = revalidateAuthSessionAgainstServer()

    bindAuthSessionEpoch(null)
    useAuthStore.setState({ user: null, status: 'anonymous' })
    const afterLogout = captureAuthSession()

    resolveMe(userA)
    const result = await pending
    assert.equal(result, 'unchanged')
    assert.equal(useAuthStore.getState().user, null)
    assert.equal(useAuthStore.getState().status, 'anonymous')
    assert.equal(isAuthSessionCurrent(afterLogout), true)

    await waitFor(() => meCalls >= 2, 'follow-up /me after stale logout')
    assert.equal(useAuthStore.getState().status, 'anonymous')
    assert.equal(captureAuthSession().userId, null)
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('HOTFIX-01 C: stale /me(A) ignored after new generation of same A', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const firstGen = captureAuthSession()

  let resolveMe!: (user: AuthUser | null) => void
  let meCalls = 0
  const originalMe = authClient.me
  const generationAtFirstMeStart = firstGen.generation

  authClient.me = () => {
    meCalls += 1
    if (meCalls === 1) {
      return new Promise<AuthUser | null>((resolve) => {
        resolveMe = resolve
      })
    }
    return Promise.resolve(userA)
  }

  try {
    const pending = revalidateAuthSessionAgainstServer()

    // Повторный login того же A → новое поколение
    bindAuthSessionEpoch('user-a')
    useAuthStore.setState({ user: userA, status: 'authenticated' })
    const secondGen = captureAuthSession()
    assert.notEqual(secondGen.generation, generationAtFirstMeStart)
    assert.equal(isAuthSessionCurrent(firstGen), false)

    const genBeforeResolve = captureAuthSession().generation
    resolveMe(userA)
    const result = await pending
    assert.equal(result, 'unchanged')
    // Устаревший ответ не бампит epoch повторно
    assert.equal(captureAuthSession().generation, genBeforeResolve)
    assert.equal(useAuthStore.getState().user?.id, 'user-a')
    assert.equal(isAuthSessionCurrent(secondGen), true)

    await waitFor(() => meCalls >= 2, 'follow-up /me after same-user regen')
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('HOTFIX-01 D: cross-tab /me(B) without local login switches to B', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })
  const before = captureAuthSession()

  const originalMe = authClient.me
  authClient.me = async () => userB
  try {
    const result = await revalidateAuthSessionAgainstServer()
    assert.equal(result, 'switched')
    assert.equal(useAuthStore.getState().user?.id, 'user-b')
    assert.equal(isAuthSessionCurrent(before), false)
    assert.equal(captureAuthSession().userId, 'user-b')
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})

test('HOTFIX-01 E: queued revalidate after stale response is not stuck', async () => {
  resetAll()
  bindAuthSessionEpoch('user-a')
  useAuthStore.setState({ user: userA, status: 'authenticated' })

  let resolveFirst!: (user: AuthUser | null) => void
  let meCalls = 0
  const callOrder: string[] = []
  const originalMe = authClient.me

  authClient.me = () => {
    meCalls += 1
    const callNo = meCalls
    callOrder.push(`me-${callNo}`)
    if (callNo === 1) {
      return new Promise<AuthUser | null>((resolve) => {
        resolveFirst = resolve
      })
    }
    return Promise.resolve(userB)
  }

  try {
    const first = revalidateAuthSessionAgainstServer()
    const coalesced = revalidateAuthSessionAgainstServer()
    assert.equal(first, coalesced)

    // Локальная смена аккаунта во время первого /me
    bindAuthSessionEpoch('user-b')
    useAuthStore.setState({ user: userB, status: 'authenticated' })
    callOrder.push('local-login-b')

    resolveFirst(userA)
    callOrder.push('resolve-stale-a')
    const firstResult = await first
    assert.equal(firstResult, 'unchanged')
    assert.equal(useAuthStore.getState().user?.id, 'user-b')

    await waitFor(() => meCalls >= 2, 'second /me after queue')
    await waitFor(
      () => useAuthStore.getState().user?.id === 'user-b',
      'B stable after follow-up',
    )

    // Третий вызов после очистки in-flight должен стартовать новый запрос
    const third = await revalidateAuthSessionAgainstServer()
    assert.equal(third, 'unchanged')
    assert.ok(meCalls >= 3, `expected fresh /me, got meCalls=${meCalls}`)
    assert.deepEqual(callOrder.slice(0, 3), [
      'me-1',
      'local-login-b',
      'resolve-stale-a',
    ])
    assert.ok(callOrder.includes('me-2'))
  } finally {
    authClient.me = originalMe
  }
  resetAll()
})
