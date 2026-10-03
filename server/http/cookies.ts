import type { AppConfig } from '../config/env.ts'
import { SESSION_COOKIE } from '../auth/sessions.ts'

export function serializeSessionCookie(
  token: string,
  config: AppConfig,
): string {
  const maxAge = Math.floor(config.sessionTtlMs / 1000)
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
  if (config.cookieSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function serializeClearSessionCookie(config: AppConfig): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ]
  if (config.cookieSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) {
      continue
    }
    const key = part.slice(0, separator).trim()
    if (key !== name) {
      continue
    }
    return decodeURIComponent(part.slice(separator + 1).trim())
  }

  return null
}
