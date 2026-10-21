import https from 'node:https'
import { isIP } from 'node:net'
import { isForbiddenAddress, YANDEX_METADATA_HOST } from './yandexFetchPolicy.ts'

export class UpstreamTimeoutError extends Error {
  constructor() {
    super('UPSTREAM_TIMEOUT')
    this.name = 'UpstreamTimeoutError'
  }
}

export class UpstreamTooLargeError extends Error {
  constructor() {
    super('UPSTREAM_TOO_LARGE')
    this.name = 'UpstreamTooLargeError'
  }
}

function allowedMetadataHost(hostname: string): boolean {
  return hostname.toLowerCase().replace(/\.$/, '') === YANDEX_METADATA_HOST
}

/**
 * TCP идёт на уже проверенный адрес. SNI и проверка сертификата
 * остаются на storage.mds.yandex.net. Повторный DNS lookup не используется.
 */
export function pinnedRequestOptions(
  url: URL,
  address: string,
  timeoutMs: number,
): https.RequestOptions {
  if (!allowedMetadataHost(url.hostname) || url.protocol !== 'https:') {
    throw new Error('refusing unpinned host')
  }
  if (url.port !== '' && url.port !== '443') {
    throw new Error('refusing unpinned port')
  }
  const family = isIP(address)
  if (family === 0 || isForbiddenAddress(address)) {
    throw new Error('refusing unpinned address')
  }
  return {
    host: address,
    servername: url.hostname,
    port: 443,
    method: 'GET',
    path: `${url.pathname}${url.search}`,
    rejectUnauthorized: true,
    timeout: timeoutMs,
    headers: {
      Host: url.hostname,
      Accept: 'application/xml, text/xml, application/json;q=0.5',
    },
    lookup: (_hostname, _options, callback) => {
      callback(null, address, family)
    },
  }
}

export function fetchPinnedMetadata(
  url: URL,
  address: string,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Response> {
  const options = pinnedRequestOptions(url, address, timeoutMs)
  return new Promise((resolve, reject) => {
    const req = https.request(options, (incoming) => {
      const chunks: Buffer[] = []
      let size = 0
      let failed = false
      incoming.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          failed = true
          incoming.destroy()
          req.destroy()
          reject(new UpstreamTooLargeError())
          return
        }
        chunks.push(chunk)
      })
      incoming.on('end', () => {
        if (failed) {
          return
        }
        const body = Buffer.concat(chunks)
        const headers = new Headers()
        const contentType = incoming.headers['content-type']
        if (typeof contentType === 'string') {
          headers.set('content-type', contentType)
        }
        if (incoming.headers.location && typeof incoming.headers.location === 'string') {
          headers.set('location', incoming.headers.location)
        }
        resolve(new Response(body, { status: incoming.statusCode ?? 502, headers }))
      })
      incoming.on('error', reject)
    })
    const fail = (error: Error) => {
      req.destroy()
      reject(error)
    }
    req.on('timeout', () => fail(new UpstreamTimeoutError()))
    req.on('error', reject)
    if (signal) {
      if (signal.aborted) {
        fail(new UpstreamTimeoutError())
        return
      }
      signal.addEventListener('abort', () => fail(new UpstreamTimeoutError()), { once: true })
    }
    req.end()
  })
}
