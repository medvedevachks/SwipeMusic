import type { YandexAuthSession } from './types'

export type YandexPublicProfile = {
  displayName: string | null
  hasPlus: boolean
  uid: number | null
}

export type YandexConnectionView =
  | { kind: 'unauthenticated' }
  | { kind: 'status'; connected: boolean; profile: YandexPublicProfile | null }

const STATUS_URL = '/api/me/providers/yandex/status'
const SESSION_URL = '/api/me/providers/yandex/session'

export class YandexSessionRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'YandexSessionRequestError'
    this.status = status
    this.code = code
  }
}

export function parseYandexStatusBody(body: unknown): YandexConnectionView {
  if (!body || typeof body !== 'object') {
    return { kind: 'status', connected: false, profile: null }
  }
  const record = body as Record<string, unknown>
  if (record.connected !== true) {
    return { kind: 'status', connected: false, profile: null }
  }
  return {
    kind: 'status',
    connected: true,
    profile: {
      displayName: typeof record.displayName === 'string' ? record.displayName : null,
      hasPlus: record.hasPlus === true,
      uid: typeof record.uid === 'number' && Number.isFinite(record.uid) ? record.uid : null,
    },
  }
}

async function request(
  url: string,
  options: { method?: string; body?: unknown } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status, body }
}

export async function readYandexConnection(
  fetchImpl: typeof fetch = fetch,
): Promise<YandexConnectionView> {
  const result = await request(STATUS_URL, {}, fetchImpl)
  if (result.status === 401) {
    return { kind: 'unauthenticated' }
  }
  if (result.status !== 200) {
    throw new YandexSessionRequestError(result.status, 'STATUS_FAILED')
  }
  return parseYandexStatusBody(result.body)
}

export async function saveYandexConnection(
  session: YandexAuthSession,
  fetchImpl: typeof fetch = fetch,
): Promise<YandexPublicProfile> {
  const result = await request(
    SESSION_URL,
    {
      method: 'PUT',
      body: {
        accessToken: session.accessToken,
        ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
        ...(session.expiresAt != null ? { expiresAt: session.expiresAt } : {}),
        ...(session.tokenType ? { tokenType: session.tokenType } : {}),
      },
    },
    fetchImpl,
  )
  if (result.status === 401) {
    const code =
      result.body &&
      typeof result.body === 'object' &&
      typeof (result.body as { error?: unknown }).error === 'string'
        ? (result.body as { error: string }).error
        : 'UNAUTHENTICATED'
    throw new YandexSessionRequestError(401, code)
  }
  if (result.status !== 200) {
    throw new YandexSessionRequestError(result.status, 'SAVE_FAILED')
  }
  const parsed = parseYandexStatusBody(result.body)
  if (parsed.kind !== 'status' || !parsed.connected || !parsed.profile) {
    throw new YandexSessionRequestError(result.status, 'SAVE_FAILED')
  }
  return parsed.profile
}

export async function deleteYandexConnection(fetchImpl: typeof fetch = fetch): Promise<void> {
  const result = await request(SESSION_URL, { method: 'DELETE' }, fetchImpl)
  if (result.status === 401 || result.status === 200) {
    return
  }
  throw new YandexSessionRequestError(result.status, 'DELETE_FAILED')
}
