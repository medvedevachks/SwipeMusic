import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { test } from 'node:test'
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.ts'
import { PasswordBusyError, createPasswordWorkLimiter } from './passwordWork.ts'

const work = createPasswordWorkLimiter(4)
const LEGACY_HORSE_HASH =
  'scrypt$v1$16384$8$1$JHY_SWGqjMKABK_jnPRdJQ$WxMN7nP4jv2IbtoYtQL0ITFiKxBmnmT9Otmab7iys8o'

function legacyHash(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
  return [
    'scrypt',
    'v1',
    '16384',
    '8',
    '1',
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

test('async hash keeps the scrypt v1 format and verifies', async () => {
  const stored = await hashPassword('correct-horse', work)
  assert.match(stored, /^scrypt\$v1\$16384\$8\$1\$[^$]+\$[^$]+$/)
  assert.equal(await verifyPassword('correct-horse', stored, work), true)
  assert.equal(await verifyPassword('wrong-password', stored, work), false)
})

test('legacy scrypt v1 hashes still verify', async () => {
  assert.equal(await verifyPassword('correct-horse', LEGACY_HORSE_HASH, work), true)
  assert.equal(await verifyPassword('other-password', LEGACY_HORSE_HASH, work), false)
  const generated = legacyHash('another-secret')
  assert.equal(await verifyPassword('another-secret', generated, work), true)
  assert.equal(
    await verifyPassword('dummy-password-not-a-secret', DUMMY_PASSWORD_HASH, work),
    true,
  )
})

test('malformed password hashes do not throw', async () => {
  const samples = [
    '',
    'not-a-hash',
    'scrypt$v1$16384$8$1$$',
    'scrypt$v2$16384$8$1$aaaa$bbbb',
    'scrypt$v1$1$8$1$aaaa$bbbb',
    'scrypt$v1$16384$8$1$aa$bb',
  ]
  for (const stored of samples) {
    assert.equal(await verifyPassword('correct-horse', stored, work), false)
  }
})

test('password work overflow rejects instead of queueing', async () => {
  const gate = createPasswordWorkLimiter(1)
  let release = (): void => {}
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = gate.run(() => hold)
  await assert.rejects(gate.run(() => Promise.resolve('later')), PasswordBusyError)
  release()
  await first
})
