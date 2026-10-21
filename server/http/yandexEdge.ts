import type { IncomingMessage, ServerResponse } from 'node:http'
import { requireUserId, sendJson } from './currentUser.ts'
import {
  nextRedirectTarget,
  resolveHostAddresses,
  validateMetadataTarget,
  YANDEX_FETCH_MAX_REDIRECTS,
  type HostResolver,
} from './yandexFetchPolicy.ts'
import type { YandexRouteContext } from './yandexRoutes.ts'
import type { YandexUpstream } from '../providers/yandexSession.ts'
import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  UpstreamTimeoutError,
  UpstreamTooLargeError,
  createUpstreamDeadline,
  fetchPinnedMetadata,
  normalizeUpstreamError,
  readResponseLimited,
  withDeadline,
} from './pinnedHttps.ts'

const OAUTH_PATHS = new Map<string, string>([
  ['/api/yandex-oauth/device/code', 'https://oauth.yandex.ru/device/code'],
  ['/api/yandex-oauth/token', 'https://oauth.yandex.ru/token'],
])

const MAX_OAUTH_BODY = 16_384
const MAX_METADATA_BODY = 1_048_576

export type MetadataHop = {
  url: URL
  address: string
}

export type MetadataTransport = (hop: MetadataHop, init: RequestInit) => Promise<Response>

type EdgeContext = YandexRouteContext & {
  yandexOauthUpstream?: YandexUpstream
  yandexMetadataUpstream?: YandexUpstream
  metadataTransport?: MetadataTransport
  resolveMetadataHost?: HostResolver
  metadataBodyLimit?: number
}

function oauthUpstream(context: EdgeContext): YandexUpstream {
  return context.yandexOauthUpstream ?? ((url, init) => fetch(url, init))
}

export function handleHealth(req: IncomingMessage, res: ServerResponse): void {
  if ((req.method ?? 'GET') !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }
  sendJson(res, 200, { ok: true })
}

export async function handleYandexOauthProxy(
  req: IncomingMessage,
  res: ServerResponse,
  context: EdgeContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const upstreamUrl = OAUTH_PATHS.get(url.pathname)
  if (!upstreamUrl) {
    sendJson(res, 404, { error: 'NOT_FOUND' })
    return
  }
  if ((req.method ?? 'GET') !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const userId = requireUserId(req, res, context)
  if (!userId) {
    return
  }

  const body = await readLimited(req, MAX_OAUTH_BODY)
  if (body === 'too-large') {
    sendJson(res, 400, { error: 'VALIDATION' })
    return
  }

  const deadline = createUpstreamDeadline(timeoutMs(context))
  try {
    const upstream = await withDeadline(
      oauthUpstream(context)(upstreamUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new Uint8Array(body),
        signal: deadline.signal,
      }),
      deadline,
    )
    const payload = await withDeadline(
      readResponseLimited(upstream, MAX_OAUTH_BODY, deadline.signal),
      deadline,
    )
    if (payload === 'too-large') {
      sendJson(res, 502, { error: 'UPSTREAM' })
      return
    }
    writeUpstream(res, upstream.status, upstream.headers.get('content-type'), payload)
  } catch (error) {
    sendUpstreamFailure(res, normalizeUpstreamError(error, deadline.signal))
  } finally {
    deadline.stop()
  }
}

export async function handleYandexFetchProxy(
  req: IncomingMessage,
  res: ServerResponse,
  context: EdgeContext,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') {
    res.setHeader('Allow', 'GET')
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const userId = requireUserId(req, res, context)
  if (!userId) {
    return
  }

  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
  const rawTarget = requestUrl.searchParams.get('url') ?? ''
  const resolveHost = context.resolveMetadataHost ?? resolveHostAddresses
  const limit = context.metadataBodyLimit ?? MAX_METADATA_BODY
  const deadline = createUpstreamDeadline(timeoutMs(context))
  try {
    let target = await withDeadline(validateMetadataTarget(rawTarget, resolveHost), deadline)
    if (!target.ok) {
      sendJson(res, 400, { error: 'FORBIDDEN_TARGET' })
      return
    }

    let response: Response | null = null
    for (let hop = 0; hop <= YANDEX_FETCH_MAX_REDIRECTS; hop += 1) {
      response = await withDeadline(
        dispatchMetadata(context, target, limit, deadline.signal),
        deadline,
      )
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break
      }
      void response.body?.cancel().catch(() => {})
      if (hop === YANDEX_FETCH_MAX_REDIRECTS) {
        sendJson(res, 400, { error: 'FORBIDDEN_TARGET' })
        return
      }
      const next = await withDeadline(
        nextRedirectTarget(target.url, response.headers.get('location'), resolveHost),
        deadline,
      )
      if (!next.ok) {
        sendJson(res, 400, { error: 'FORBIDDEN_TARGET' })
        return
      }
      target = next
      response = null
    }

    if (!response) {
      sendJson(res, 502, { error: 'UPSTREAM' })
      return
    }
    const payload = await withDeadline(readResponseLimited(response, limit, deadline.signal), deadline)
    if (payload === 'too-large') {
      sendJson(res, 502, { error: 'UPSTREAM' })
      return
    }
    writeUpstream(res, response.status, response.headers.get('content-type'), payload)
  } catch (error) {
    sendUpstreamFailure(res, normalizeUpstreamError(error, deadline.signal))
  } finally {
    deadline.stop()
  }
}

function timeoutMs(context: EdgeContext): number {
  return context.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
}

function dispatchMetadata(
  context: EdgeContext,
  target: { url: URL; address: string },
  limit: number,
  signal: AbortSignal,
): Promise<Response> {
  const init: RequestInit = {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'application/xml, text/xml, application/json;q=0.5' },
    signal,
  }
  if (context.metadataTransport) {
    return context.metadataTransport(target, init)
  }
  if (context.yandexMetadataUpstream) {
    return context.yandexMetadataUpstream(target.url.toString(), init)
  }
  return fetchPinnedMetadata(target.url, target.address, timeoutMs(context), limit, signal)
}

function sendUpstreamFailure(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  if (error instanceof UpstreamTimeoutError || (error instanceof Error && error.name === 'TimeoutError')) {
    sendJson(res, 504, { error: 'UPSTREAM_TIMEOUT' })
    return
  }
  if (error instanceof UpstreamTooLargeError) {
    sendJson(res, 502, { error: 'UPSTREAM' })
    return
  }
  sendJson(res, 502, { error: 'UPSTREAM' })
}

function writeUpstream(
  res: ServerResponse,
  status: number,
  contentType: string | null,
  body: Buffer,
): void {
  res.writeHead(status, {
    'Content-Type': contentType ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  })
  res.end(body)
}

function readLimited(req: IncomingMessage, max: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        resolve('too-large')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
