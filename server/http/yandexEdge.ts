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

const OAUTH_PATHS = new Map<string, string>([
  ['/api/yandex-oauth/device/code', 'https://oauth.yandex.ru/device/code'],
  ['/api/yandex-oauth/token', 'https://oauth.yandex.ru/token'],
])

const MAX_OAUTH_BODY = 16_384
const MAX_METADATA_BODY = 1_048_576

type EdgeContext = YandexRouteContext & {
  yandexOauthUpstream?: YandexUpstream
  yandexMetadataUpstream?: YandexUpstream
  resolveMetadataHost?: HostResolver
}

function oauthUpstream(context: EdgeContext): YandexUpstream {
  return context.yandexOauthUpstream ?? ((url, init) => fetch(url, init))
}

function metadataUpstream(context: EdgeContext): YandexUpstream {
  return context.yandexMetadataUpstream ?? ((url, init) => fetch(url, init))
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

  let upstream: Response
  try {
    upstream = await oauthUpstream(context)(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new Uint8Array(body),
    })
  } catch {
    sendJson(res, 502, { error: 'UPSTREAM' })
    return
  }

  const payload = await readResponseLimited(upstream, MAX_OAUTH_BODY)
  if (payload === 'too-large') {
    sendJson(res, 502, { error: 'UPSTREAM' })
    return
  }
  writeUpstream(res, upstream.status, upstream.headers.get('content-type'), payload)
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
  let target = await validateMetadataTarget(rawTarget, resolveHost)
  if (!target.ok) {
    sendJson(res, 400, { error: 'FORBIDDEN_TARGET' })
    return
  }

  const upstreamFetch = metadataUpstream(context)
  let response: Response | null = null
  for (let hop = 0; hop <= YANDEX_FETCH_MAX_REDIRECTS; hop += 1) {
    try {
      response = await upstreamFetch(target.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/xml, text/xml, application/json;q=0.5' },
      })
    } catch {
      sendJson(res, 502, { error: 'UPSTREAM' })
      return
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      break
    }
    if (hop === YANDEX_FETCH_MAX_REDIRECTS) {
      sendJson(res, 400, { error: 'FORBIDDEN_TARGET' })
      return
    }
    const next = await nextRedirectTarget(
      target.url,
      response.headers.get('location'),
      resolveHost,
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
  const payload = await readResponseLimited(response, MAX_METADATA_BODY)
  if (payload === 'too-large') {
    sendJson(res, 502, { error: 'UPSTREAM' })
    return
  }
  writeUpstream(res, response.status, response.headers.get('content-type'), payload)
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

async function readResponseLimited(
  response: Response,
  max: number,
): Promise<Buffer | 'too-large'> {
  const reader = response.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const step = await reader.read()
    if (step.done) {
      break
    }
    size += step.value.byteLength
    if (size > max) {
      await reader.cancel()
      return 'too-large'
    }
    chunks.push(step.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}
