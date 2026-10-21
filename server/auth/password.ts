import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { PasswordWorkLimiter } from './passwordWork.ts'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const FALLBACK_SALT = Buffer.alloc(SALT_LENGTH, 0x5a)

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

type ParsedHash = {
  salt: Buffer
  key: Buffer
}

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  work: PasswordWorkLimiter,
): Promise<Buffer> {
  return work.run(() =>
    scryptAsync(password, salt, keyLength, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    }),
  )
}

function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    return null
  }

  const n = Number(parts[2])
  const r = Number(parts[3])
  const p = Number(parts[4])
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return null
  }

  const salt = Buffer.from(parts[5] ?? '', 'base64url')
  const key = Buffer.from(parts[6] ?? '', 'base64url')
  if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) {
    return null
  }

  return { salt, key }
}

/** Версионируемый hash: scrypt$v1$N$r$p$salt$key */
export async function hashPassword(
  password: string,
  work: PasswordWorkLimiter,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, KEY_LENGTH, work)
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

export async function verifyPassword(
  password: string,
  stored: string,
  work: PasswordWorkLimiter,
): Promise<boolean> {
  const parsed = parseStoredHash(stored)
  if (!parsed) {
    await derive(password, FALLBACK_SALT, KEY_LENGTH, work)
    return false
  }

  const actual = await derive(password, parsed.salt, KEY_LENGTH, work)
  if (actual.length !== parsed.key.length) {
    return false
  }

  return timingSafeEqual(actual, parsed.key)
}

/**
 * Фиктивный hash прежнего формата. Проверка неизвестного email
 * выполняет такой же async scrypt, как проверка реального пароля.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$v1$16384$8$1$fhx_YOtWKGhIFOtmIl-T4g$IAdSndYZMpEnPWcM1qPiuRjuOdyIasJjzPGXhcZHiyo'
