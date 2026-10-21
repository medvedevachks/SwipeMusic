import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthApiError } from './types.ts'
import { TOO_MANY_ATTEMPTS_MESSAGE, authRateLimitMessage } from './messages.ts'

test('login and register rate limit uses one public message', () => {
  assert.equal(
    authRateLimitMessage(new AuthApiError(429, 'RATE_LIMITED', {})),
    TOO_MANY_ATTEMPTS_MESSAGE,
  )
  assert.equal(TOO_MANY_ATTEMPTS_MESSAGE, 'Слишком много попыток. Попробуйте позже.')
  assert.equal(authRateLimitMessage(new AuthApiError(401, 'INVALID_CREDENTIALS', {})), null)
  assert.equal(TOO_MANY_ATTEMPTS_MESSAGE.includes('15'), false)
  assert.equal(TOO_MANY_ATTEMPTS_MESSAGE.toLowerCase().includes('email'), false)
})
