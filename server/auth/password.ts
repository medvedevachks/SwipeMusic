import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 32

function derive(password: string, salt: Buffer, keyLength: number): Buffer {
  return scryptSync(password, salt, keyLength, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
}

/** Версионируемый hash: scrypt$v1$N$r$p$salt$key */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = derive(password, salt, KEY_LENGTH)
  return [
    'scrypt',
    'v1',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    return false
  }

  const n = Number(parts[2])
  const r = Number(parts[3])
  const p = Number(parts[4])
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return false
  }

  const salt = Buffer.from(parts[5] ?? '', 'base64url')
  const expected = Buffer.from(parts[6] ?? '', 'base64url')
  if (salt.length === 0 || expected.length === 0) {
    return false
  }

  const actual = derive(password, salt, expected.length)
  if (actual.length !== expected.length) {
    return false
  }

  return timingSafeEqual(actual, expected)
}

/** Фиктивный hash, чтобы ответ на неизвестный email не был быстрее проверки пароля. */
export const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-not-a-secret')
