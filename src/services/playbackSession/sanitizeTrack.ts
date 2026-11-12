import type { Track } from '../../types/track.ts'
import type { SessionTrack } from './types.ts'

/**
 * Query-параметры, допустимые для image CDN (resize/format).
 * Не являются секретами авторизации.
 */
const SAFE_COVER_QUERY_KEYS = new Set([
  'w',
  'h',
  'width',
  'height',
  'size',
  'sz',
  'fit',
  'crop',
  'format',
  'fm',
  'quality',
  'q',
  'auto',
  'dpr',
  'scale',
  'resize',
  'thumb',
  'type',
])

/**
 * Имена query-параметров, похожие на credentials / signed URL.
 * При их наличии coverUrl отбрасывается целиком (не «чистим вслепую»).
 */
const CREDENTIAL_LIKE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'auth',
  'authorization',
  'signature',
  'sig',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signedheaders',
  'x-amz-date',
  'x-amz-expires',
  'expires',
  'expire',
  'expiry',
  'key',
  'api_key',
  'apikey',
  'client_secret',
  'secret',
  'password',
  'jwt',
  'bearer',
  'session',
  'sessionid',
  'sid',
])

export type CoverUrlSanitizeResult =
  | { ok: true; coverUrl: string | null }
  | { ok: false; reason: string; coverUrl: null }

/**
 * Политика cover URL:
 * - только http/https;
 * - data:/blob:/javascript: → null;
 * - при credential-like query → null (не strip вслепую: image CDN может
 *   требовать свои параметры, а signed URL нельзя безопасно «починить»);
 * - safe image params сохраняются;
 * - неизвестные query без credential-признаков сохраняются (CDN variants).
 */
export function sanitizeCoverUrl(raw: string | null | undefined): CoverUrlSanitizeResult {
  if (raw == null || raw === '') {
    return { ok: true, coverUrl: raw ?? null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'coverUrl_not_string', coverUrl: null }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'coverUrl_unparseable', coverUrl: null }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'coverUrl_bad_protocol', coverUrl: null }
  }
  for (const key of url.searchParams.keys()) {
    const lower = key.toLowerCase()
    if (
      CREDENTIAL_LIKE_QUERY_KEYS.has(lower) ||
      lower.startsWith('x-amz-') ||
      lower.startsWith('x-goog-')
    ) {
      return { ok: false, reason: 'coverUrl_credential_query', coverUrl: null }
    }
  }
  // Пересобираем URL: host+path + только не-credential params (все оставшиеся уже проверены).
  // Safe set используется как документация allowlist; неизвестные не-credential оставляем.
  void SAFE_COVER_QUERY_KEYS
  return { ok: true, coverUrl: url.toString() }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Копия трека в SessionTrack без stream URL и секретов.
 * Вход может быть Track или уже SessionTrack-подобным объектом.
 */
export function toSessionTrack(input: Track | SessionTrack | Record<string, unknown>): SessionTrack {
  const id = typeof input.id === 'string' ? input.id : ''
  const sourceId = typeof input.sourceId === 'string' ? input.sourceId : ''
  const externalId = typeof input.externalId === 'string' ? input.externalId : ''
  const title = typeof input.title === 'string' ? input.title : ''
  const artist = typeof input.artist === 'string' ? input.artist : ''

  const coverRaw =
    'coverUrl' in input ? (input.coverUrl as string | null | undefined) : undefined
  const cover = sanitizeCoverUrl(coverRaw)

  const out: SessionTrack = {
    id,
    sourceId,
    externalId,
    title,
    artist,
    coverUrl: cover.coverUrl,
  }

  if ('album' in input && typeof input.album === 'string') {
    out.album = input.album
  }
  if ('genre' in input && typeof input.genre === 'string') {
    out.genre = input.genre
  }
  if ('year' in input && isFiniteNumber(input.year)) {
    out.year = input.year
  }
  if ('durationMs' in input && isFiniteNumber(input.durationMs)) {
    out.durationMs = input.durationMs
  }
  if ('coverColor' in input && typeof input.coverColor === 'string') {
    out.coverColor = input.coverColor
  }
  if ('tags' in input && Array.isArray(input.tags)) {
    out.tags = input.tags.filter((tag): tag is string => typeof tag === 'string')
  }

  // previewUrl и любые прочие поля намеренно не копируются.
  return out
}

/** @deprecated alias — используйте toSessionTrack */
export function sanitizeSessionTrack(track: Track | SessionTrack): SessionTrack {
  return toSessionTrack(track)
}

export function toSessionTracks(
  tracks: readonly (Track | SessionTrack | Record<string, unknown>)[],
): SessionTrack[] {
  return tracks.map((track) => toSessionTrack(track))
}

export function sanitizeSessionTracks(
  tracks: readonly (Track | SessionTrack)[],
): SessionTrack[] {
  return toSessionTracks(tracks)
}

/** Проверка: объект не содержит запрещённых сериализацией полей. */
export function sessionTrackHasForbiddenFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  if ('previewUrl' in record && record.previewUrl != null && record.previewUrl !== '') {
    return true
  }
  if (typeof record.streamUrl === 'string' && record.streamUrl) {
    return true
  }
  if (typeof record.downloadUrl === 'string' && record.downloadUrl) {
    return true
  }
  if (typeof record.authToken === 'string' && record.authToken) {
    return true
  }
  return false
}
