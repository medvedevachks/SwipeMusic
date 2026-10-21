/**
 * CSRF для POST, PUT, PATCH и DELETE.
 *
 * Браузер на таких запросах сам ставит Origin. Чужой Origin и
 * Sec-Fetch-Site: cross-site отклоняются. Заголовок Host и
 * X-Forwarded-Host не участвуют: доверенный origin берётся только
 * из конфигурации.
 *
 * Нет Origin — отказ. Иначе запрос без Origin обходил бы проверку.
 * Тесты и curl передают Origin явно. SameSite=Lax остаётся, но
 * защитой не считается.
 *
 * GET, HEAD и OPTIONS не проверяются.
 * Sec-Fetch-Site: same-origin, same-site или none допускается только
 * вместе с Origin из списка. Поддомен с чужим Origin не проходит.
 */

export const PRODUCTION_APP_ORIGIN = 'https://app.swipe-music.site'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function canonicalHttpOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password) {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  if (url.origin !== value) {
    return null
  }
  return url.origin
}

export function evaluateOrigin(input: {
  method: string
  origin: string | string[] | undefined
  secFetchSite: string | string[] | undefined
  allowedOrigins: readonly string[]
}): { ok: true } | { ok: false } {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) {
    return { ok: true }
  }
  if (singleHeader(input.secFetchSite) === 'cross-site') {
    return { ok: false }
  }
  const origin = singleHeader(input.origin)
  if (!origin || !input.allowedOrigins.includes(origin)) {
    return { ok: false }
  }
  return { ok: true }
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
