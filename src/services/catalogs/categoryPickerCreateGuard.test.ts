import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bindAuthSessionEpoch,
  captureAuthSession,
  resetAuthSessionEpochForTests,
  StaleLibrarySessionError,
} from '../auth/sessionEpoch.ts'
import {
  canApplyCategoryPickerCreate,
  isRetryableCategoryCreateError,
} from './categoryPickerCreateGuard.ts'

test('picker unmount before apply blocks onSelect', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  const session = captureAuthSession()
  assert.equal(canApplyCategoryPickerCreate(false, session), false)
  assert.equal(canApplyCategoryPickerCreate(true, session), true)
  resetAuthSessionEpochForTests()
})

test('picker session switch after create blocks onSelect and false success', () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  const session = captureAuthSession()
  bindAuthSessionEpoch('user-b')
  assert.equal(canApplyCategoryPickerCreate(true, session), false)
  resetAuthSessionEpochForTests()
})

test('network errors remain retryable; stale session errors do not', () => {
  assert.equal(isRetryableCategoryCreateError(new Error('network')), true)
  assert.equal(
    isRetryableCategoryCreateError(new StaleLibrarySessionError()),
    false,
  )
})
