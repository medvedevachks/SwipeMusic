export const YANDEX_MUSIC_SOURCE_ID = 'yandex-music'

export const YANDEX_MUSIC_ALLOWED_HOSTS = [
  'music.yandex.ru',
  'www.music.yandex.ru',
  'music.yandex.com',
  'music.yandex.by',
  'music.yandex.kz',
  'music.yandex.uz',
] as const

const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'file', 'blob', 'vbscript', 'about'])
const AUDIO_PATH = /\.(mp3|m3u8|aac|ogg|flac|wav|mp4|webm)(?:$|[/?#])/i

export type YandexMusicUrlValidation =
  | { ok: true; href: string; host: string }
  | { ok: false; error: string }

export function validateYandexMusicPageUrl(raw: string): YandexMusicUrlValidation {
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
    return { ok: false, error: 'Допустимы только HTTPS-ссылки music.yandex.ru' }
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

  if (!(YANDEX_MUSIC_ALLOWED_HOSTS as readonly string[]).includes(host)) {
    return { ok: false, error: 'Разрешены только страницы music.yandex.ru' }
  }

  if (AUDIO_PATH.test(url.pathname) || AUDIO_PATH.test(url.search)) {
    return { ok: false, error: 'Прямые аудиоссылки не принимаются' }
  }

  if (!/\/(album|track)\//.test(url.pathname)) {
    return { ok: false, error: 'Нужна ссылка на альбом или композицию Яндекс Музыки' }
  }

  url.hash = ''
  return { ok: true, href: url.toString(), host }
}

export function assertYandexMusicPageUrl(raw: string): string {
  const result = validateYandexMusicPageUrl(raw)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.href
}
