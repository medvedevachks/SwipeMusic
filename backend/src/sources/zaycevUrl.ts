export const ZAYCEV_SOURCE_ID = 'zaycev'

export const ZAYCEV_ALLOWED_HOSTS = ['zaycev.net', 'www.zaycev.net', 'ru.zaycev.net'] as const

const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'file', 'blob', 'vbscript', 'about'])
const AUDIO_PATH = /\.(mp3|m3u8|aac|ogg|flac|wav|mp4|webm)(?:$|[/?#])/i

export type ZaycevUrlValidation =
  | { ok: true; href: string; host: string }
  | { ok: false; error: string }

export function validateZaycevPageUrl(raw: string): ZaycevUrlValidation {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Укажите ссылку' }
  }
  if (trimmed.length > 2048) {
    return { ok: false, error: 'Ссылка слишком длинная' }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Некорректная ссылка' }
  }

  const protocol = url.protocol.replace(':', '').toLowerCase()
  if (BLOCKED_SCHEMES.has(protocol) || protocol !== 'https') {
    return { ok: false, error: 'Допустимы только HTTPS-ссылки zaycev.net' }
  }

  if (url.username || url.password) {
    return { ok: false, error: 'Ссылка содержит недопустимые данные' }
  }

  if (url.port && url.port !== '443') {
    return { ok: false, error: 'Недопустимый порт' }
  }

  const host = url.hostname.toLowerCase()
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, error: 'Недопустимый домен' }
  }

  if (!(ZAYCEV_ALLOWED_HOSTS as readonly string[]).includes(host)) {
    return { ok: false, error: 'Разрешены только страницы zaycev.net' }
  }

  if (AUDIO_PATH.test(url.pathname) || AUDIO_PATH.test(url.search)) {
    return { ok: false, error: 'Прямые аудиоссылки не принимаются' }
  }

  if (!url.pathname || url.pathname === '/') {
    return { ok: false, error: 'Нужна ссылка на конкретную композицию' }
  }

  url.hash = ''
  return { ok: true, href: url.toString(), host }
}

export function assertZaycevPageUrl(raw: string): string {
  const result = validateZaycevPageUrl(raw)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.href
}
