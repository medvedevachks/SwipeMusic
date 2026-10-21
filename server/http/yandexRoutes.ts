import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config/env.ts'
import {
  createYandexSessionService,
  parseYandexSessionBody,
  type YandexUpstream,
} from '../providers/yandexSession.ts'
import { readJsonBody, requireUserId, sendJson } from './currentUser.ts'
import {
  createUpstreamDeadline,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  normalizeUpstreamError,
  readResponseLimited,
  UpstreamTimeoutError,
  withDeadline,
} from './pinnedHttps.ts'

export type YandexRouteContext = {
  db: DatabaseSync
  config: AppConfig
  yandexUpstream?: YandexUpstream
  upstreamTimeoutMs?: number
  musicBodyLimit?: number
}

const PREFIX = '/api/yandex-music'
const UPSTREAM_ORIGIN = 'https://api.music.yandex.net'

/**
 * Один ответ api.music.yandex.net.
 * likes/tracks — ссылки на треки, около 200 байт на лайк: 100 тысяч лайков ≈ 20 МиБ.
 * Плейлист приходит целиком, с объектами треков; пачка /tracks — по 50 id, поиск — страница.
 * 32 МиБ хватает на такую библиотеку и плейлист в несколько тысяч треков.
 */
export const MAX_MUSIC_UPSTREAM_BODY = 32 * 1024 * 1024

function upstreamOf(context: YandexRouteContext): YandexUpstream {
  return context.yandexUpstream ?? ((url, init) => fetch(url, init))
}

function requireKey(context: YandexRouteContext, res: ServerResponse): Buffer | null {
  if (!context.config.providerSessionKey) {
    sendJson(res, 500, { error: 'INTERNAL' })
    return null
  }
  return context.config.providerSessionKey
}

export async function handleYandexProviderRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: YandexRouteContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'
  if (
    path !== '/api/me/providers/yandex/status' &&
    path !== '/api/me/providers/yandex/session'
  ) {
    sendJson(res, 404, { error: 'NOT_FOUND' })
    return
  }

  const userId = requireUserId(req, res, context)
  if (!userId) {
    return
  }
  const key = requireKey(context, res)
  if (!key) {
    return
  }
  const service = createYandexSessionService(context.db, key)

  if (method === 'GET' && path === '/api/me/providers/yandex/status') {
    sendJson(res, 200, service.status(userId))
    return
  }

  if (method === 'PUT' && path === '/api/me/providers/yandex/session') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
      return
    }
    const parsed = parseYandexSessionBody(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }
    const saved = await service.save(userId, parsed.value, upstreamOf(context))
    if (!saved.ok) {
      sendJson(res, 401, { error: 'YANDEX_AUTH_REQUIRED' })
      return
    }
    sendJson(res, 200, saved.status)
    return
  }

  if (method === 'DELETE' && path === '/api/me/providers/yandex/session') {
    sendJson(res, 200, service.disconnect(userId))
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}

export async function handleYandexMusicProxy(
  req: IncomingMessage,
  res: ServerResponse,
  context: YandexRouteContext,
): Promise<void> {
  const userId = requireUserId(req, res, context)
  if (!userId) {
    return
  }
  const key = requireKey(context, res)
  if (!key) {
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const relative = yandexRelativePath(url.pathname)
  if (!relative) {
    sendJson(res, 400, { error: 'VALIDATION' })
    return
  }

  const service = createYandexSessionService(context.db, key)
  const accessToken = service.accessToken(userId)
  if (!accessToken) {
    sendJson(res, 401, { error: 'YANDEX_AUTH_REQUIRED' })
    return
  }

  const method = req.method ?? 'GET'
  const deadline = createUpstreamDeadline(context.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS)
  const limit = context.musicBodyLimit ?? MAX_MUSIC_UPSTREAM_BODY
  try {
    const upstreamResponse = await withDeadline(
      upstreamOf(context)(`${UPSTREAM_ORIGIN}${relative}${url.search}`, {
        method,
        headers: {
          Authorization: `OAuth ${accessToken}`,
          Accept: 'application/json',
        },
        signal: deadline.signal,
      }),
      deadline,
    )

    if (upstreamResponse.status === 401) {
      void upstreamResponse.body?.cancel().catch(() => {})
      service.invalidate(userId)
      sendJson(res, 401, { error: 'YANDEX_AUTH_REQUIRED' })
      return
    }

    const payload = await withDeadline(
      readResponseLimited(upstreamResponse, limit, deadline.signal),
      deadline,
    )
    if (payload === 'too-large') {
      sendJson(res, 502, { error: 'UPSTREAM' })
      return
    }
    const text = payload.toString('utf8').split(accessToken).join('[redacted]')
    const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8'
    res.writeHead(upstreamResponse.status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
    })
    res.end(text)
  } catch (error) {
    if (res.headersSent) {
      res.end()
      return
    }
    const normalized = normalizeUpstreamError(error, deadline.signal)
    if (normalized instanceof UpstreamTimeoutError) {
      sendJson(res, 504, { error: 'UPSTREAM_TIMEOUT' })
      return
    }
    sendJson(res, 502, { error: 'UPSTREAM' })
  } finally {
    deadline.stop()
  }
}

function yandexRelativePath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) {
    return null
  }
  const relative = pathname.slice(PREFIX.length) || '/'
  if (!relative.startsWith('/') || relative.includes('..') || relative.includes('\\')) {
    return null
  }
  return relative
}
