import type { DatabaseSync } from 'node:sqlite'
import { createProviderConnectionRepository } from './connectionRepository.ts'
import {
  decryptProviderSession,
  encryptProviderSession,
  type StoredProviderSession,
} from './sessionCrypto.ts'

export const YANDEX_PROVIDER_ID = 'yandex-music'
const YANDEX_ACCOUNT_STATUS = 'https://api.music.yandex.net/account/status'

export type YandexUpstream = (url: string, init: RequestInit) => Promise<Response>

export type YandexPublicStatus = {
  connected: boolean
  displayName?: string | null
  hasPlus?: boolean
  uid?: number | null
}

export type YandexSessionInput = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
}

export function parseYandexSessionBody(
  body: unknown,
): { ok: true; value: YandexSessionInput } | { ok: false; fields: Record<string, string> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, fields: { body: 'Некорректное тело' } }
  }
  const record = body as Record<string, unknown>
  if (typeof record.accessToken !== 'string' || record.accessToken.trim().length === 0) {
    return { ok: false, fields: { accessToken: 'Нужен accessToken' } }
  }
  const value: YandexSessionInput = {
    accessToken: record.accessToken,
  }
  if (typeof record.refreshToken === 'string' && record.refreshToken.length > 0) {
    value.refreshToken = record.refreshToken
  }
  if (typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)) {
    value.expiresAt = record.expiresAt
  }
  if (typeof record.tokenType === 'string' && record.tokenType.length > 0) {
    value.tokenType = record.tokenType
  }
  return { ok: true, value }
}

export function toPublicStatus(session: StoredProviderSession | null): YandexPublicStatus {
  if (!session) {
    return { connected: false }
  }
  return {
    connected: true,
    displayName: session.displayName,
    hasPlus: session.hasPlus,
    uid: session.uid,
  }
}

export async function verifyYandexAccessToken(
  accessToken: string,
  upstream: YandexUpstream,
): Promise<
  | { ok: true; profile: Pick<StoredProviderSession, 'displayName' | 'hasPlus' | 'uid'> }
  | { ok: false }
> {
  let response: Response
  try {
    response = await upstream(YANDEX_ACCOUNT_STATUS, {
      method: 'GET',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        Accept: 'application/json',
      },
    })
  } catch {
    return { ok: false }
  }
  if (!response.ok) {
    return { ok: false }
  }
  try {
    return { ok: true, profile: readProfile(await response.json()) }
  } catch {
    return { ok: false }
  }
}

function readProfile(payload: unknown): Pick<StoredProviderSession, 'displayName' | 'hasPlus' | 'uid'> {
  const root =
    payload && typeof payload === 'object' && 'result' in payload
      ? (payload as { result?: unknown }).result
      : payload
  const record = root && typeof root === 'object' ? (root as Record<string, unknown>) : {}
  const account =
    record.account && typeof record.account === 'object'
      ? (record.account as Record<string, unknown>)
      : {}
  const plus =
    record.plus && typeof record.plus === 'object'
      ? (record.plus as Record<string, unknown>)
      : {}
  const displayName =
    typeof account.displayName === 'string'
      ? account.displayName
      : typeof account.login === 'string'
        ? account.login
        : null
  const uid = typeof account.uid === 'number' && Number.isFinite(account.uid) ? account.uid : null
  return {
    displayName,
    hasPlus: plus.hasPlus === true,
    uid,
  }
}

export function createYandexSessionService(db: DatabaseSync, key: Buffer) {
  const connections = createProviderConnectionRepository(db)

  function read(userId: string): StoredProviderSession | null {
    const row = connections.get(userId, YANDEX_PROVIDER_ID)
    if (!row) {
      return null
    }
    return decryptProviderSession(key, row.encrypted_session)
  }

  return {
    status(userId: string): YandexPublicStatus {
      return toPublicStatus(read(userId))
    },

    async save(
      userId: string,
      input: YandexSessionInput,
      upstream: YandexUpstream,
    ): Promise<{ ok: true; status: YandexPublicStatus } | { ok: false }> {
      const verified = await verifyYandexAccessToken(input.accessToken, upstream)
      if (!verified.ok) {
        return { ok: false }
      }
      const stored: StoredProviderSession = {
        accessToken: input.accessToken,
        ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
        ...(input.expiresAt != null ? { expiresAt: input.expiresAt } : {}),
        ...(input.tokenType ? { tokenType: input.tokenType } : {}),
        displayName: verified.profile.displayName,
        hasPlus: verified.profile.hasPlus,
        uid: verified.profile.uid,
      }
      connections.save(
        userId,
        YANDEX_PROVIDER_ID,
        encryptProviderSession(key, stored),
        new Date().toISOString(),
      )
      return { ok: true, status: toPublicStatus(stored) }
    },

    disconnect(userId: string): YandexPublicStatus {
      connections.delete(userId, YANDEX_PROVIDER_ID)
      return { connected: false }
    },

    accessToken(userId: string): string | null {
      return read(userId)?.accessToken ?? null
    },

    invalidate(userId: string): void {
      connections.delete(userId, YANDEX_PROVIDER_ID)
    },
  }
}
