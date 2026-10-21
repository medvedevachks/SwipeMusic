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

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 8_000

export type UpstreamDeadline = {
  signal: AbortSignal
  promise: Promise<never>
  stop: () => void
}

/**
 * Один срок на весь upstream-вызов: DNS, заголовки и чтение тела.
 * stop() снимает таймер и не отменяет уже завершённый успех.
 * Срабатывание срока прерывает signal, чтобы оборвать сокет и чтение.
 */
export function createUpstreamDeadline(ms: number): UpstreamDeadline {
  const controller = new AbortController()
  let rejectDeadline: (error: UpstreamTimeoutError) => void = () => {}
  const promise = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  promise.catch(() => {})
  const timer = setTimeout(() => {
    controller.abort()
    rejectDeadline(new UpstreamTimeoutError())
  }, ms)
  timer.unref()
  return {
    signal: controller.signal,
    promise,
    stop: () => clearTimeout(timer),
  }
}

export function withDeadline<T>(work: Promise<T>, deadline: UpstreamDeadline): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) {
        return
      }
      settled = true
      fn()
    }
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
    deadline.promise.then(
      () => {},
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

export function normalizeUpstreamError(error: unknown, signal: AbortSignal): unknown {
  if (
    signal.aborted &&
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new UpstreamTimeoutError()
  }
  return error
}

function declaredLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const length = Number(raw)
  return Number.isSafeInteger(length) ? length : null
}

export async function readResponseLimited(
  response: Response,
  max: number,
  signal?: AbortSignal,
): Promise<Buffer | 'too-large'> {
  if (signal?.aborted) {
    throw new UpstreamTimeoutError()
  }
  const length = declaredLength(response)
  if (length !== null && length > max) {
    void response.body?.cancel().catch(() => {})
    return 'too-large'
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }
  const onAbort = () => {
    void reader.cancel(new UpstreamTimeoutError()).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      if (signal?.aborted) {
        throw new UpstreamTimeoutError()
      }
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await reader.read()
      } catch (error) {
        if (signal?.aborted) {
          throw new UpstreamTimeoutError()
        }
        throw error
      }
      if (signal?.aborted) {
        throw new UpstreamTimeoutError()
      }
      if (step.done) {
        break
      }
      size += step.value.byteLength
      if (size > max) {
        void reader.cancel().catch(() => {})
        return 'too-large'
      }
      chunks.push(step.value)
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  } finally {
    signal?.removeEventListener('abort', onAbort)
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
