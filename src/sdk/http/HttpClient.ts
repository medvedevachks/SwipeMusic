export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export type HttpRequestOptions = {
  method?: HttpMethod
  headers?: Record<string, string>
  body?: BodyInit | null
  /** Override default timeout (ms). */
  timeoutMs?: number
  /** Override default retries. */
  retries?: number
  /** Cache GET responses under this key (optional). */
  cacheKey?: string
  cacheTtlMs?: number
  signal?: AbortSignal
  /** Reserved for future proxy support. */
  proxyUrl?: string
}

export type HttpClientConfig = {
  baseUrl?: string
  defaultHeaders?: Record<string, string>
  timeoutMs?: number
  retries?: number
  /** Min interval between requests (simple rate limit). */
  minIntervalMs?: number
  cache?: {
    get: <T>(key: string) => Promise<T | null>
    set: (key: string, value: unknown, ttlMs?: number) => Promise<void>
  }
}

export type HttpResponse<T = unknown> = {
  ok: boolean
  status: number
  headers: Headers
  data: T
  url: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function mergeSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) {
      controller.abort()
    } else {
      external.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
  }
}

/**
 * Общий HTTP-клиент для API / scraper плагинов.
 */
export class HttpClient {
  private lastRequestAt = 0
  private readonly config: HttpClientConfig

  constructor(config: HttpClientConfig = {}) {
    this.config = config
  }
  async request<T = unknown>(
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const method = options.method ?? 'GET'
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 15_000
    const retries = options.retries ?? this.config.retries ?? 1

    if (method === 'GET' && options.cacheKey && this.config.cache) {
      const cached = await this.config.cache.get<HttpResponse<T>>(
        options.cacheKey,
      )
      if (cached) {
        return cached
      }
    }

    let attempt = 0
    let lastError: unknown

    while (attempt <= retries) {
      attempt += 1
      try {
        await this.throttle()
        const response = await this.doFetch<T>(path, options, timeoutMs)

        if (
          method === 'GET' &&
          options.cacheKey &&
          this.config.cache &&
          response.ok
        ) {
          await this.config.cache.set(
            options.cacheKey,
            response,
            options.cacheTtlMs,
          )
        }

        return response
      } catch (error) {
        lastError = error
        if (attempt > retries) {
          break
        }
        await sleep(200 * attempt)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('HttpClient request failed')
  }

  async getJson<T = unknown>(
    path: string,
    options: Omit<HttpRequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'GET' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${response.url}`)
    }
    return response.data
  }

  private async throttle(): Promise<void> {
    const minInterval = this.config.minIntervalMs ?? 0
    if (minInterval <= 0) {
      return
    }
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed)
    }
    this.lastRequestAt = Date.now()
  }

  private async doFetch<T>(
    path: string,
    options: HttpRequestOptions,
    timeoutMs: number,
  ): Promise<HttpResponse<T>> {
    void options.proxyUrl // reserved

    const base = this.config.baseUrl?.replace(/\/$/, '') ?? ''
    const url = path.startsWith('http')
      ? path
      : `${base}${path.startsWith('/') ? path : `/${path}`}`

    const { signal, cleanup } = mergeSignals(timeoutMs, options.signal)

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          ...this.config.defaultHeaders,
          ...options.headers,
        },
        body: options.body,
        signal,
        credentials: 'include',
      })

      const contentType = response.headers.get('content-type') ?? ''
      let data: T
      if (contentType.includes('application/json')) {
        data = (await response.json()) as T
      } else {
        data = (await response.text()) as T
      }

      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        data,
        url: response.url,
      }
    } finally {
      cleanup()
    }
  }
}
