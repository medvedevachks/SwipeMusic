import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type StoredProviderSession = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  displayName: string | null
  hasPlus: boolean
  uid: number | null
}

type Envelope = {
  v: 1
  alg: 'A256GCM'
  iv: string
  tag: string
  data: string
}

export function parseProviderSessionKey(value: string): Buffer {
  const trimmed = value.trim()
  const decoded = Buffer.from(trimmed, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== trimmed) {
    throw new Error('PROVIDER_SESSION_KEY is invalid')
  }
  return decoded
}

export function encryptProviderSession(
  key: Buffer,
  session: StoredProviderSession,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ])
  const envelope: Envelope = {
    v: 1,
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  }
  return JSON.stringify(envelope)
}

export function decryptProviderSession(
  key: Buffer,
  envelopeText: string,
): StoredProviderSession | null {
  let envelope: Envelope
  try {
    envelope = JSON.parse(envelopeText) as Envelope
    if (
      envelope.v !== 1 ||
      envelope.alg !== 'A256GCM' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.data !== 'string'
    ) {
      return null
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    return parseStoredSession(JSON.parse(plaintext) as unknown)
  } catch {
    return null
  }
}

function parseStoredSession(value: unknown): StoredProviderSession | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.accessToken !== 'string' || record.accessToken.length === 0) {
    return null
  }
  return {
    accessToken: record.accessToken,
    ...(typeof record.refreshToken === 'string' && record.refreshToken.length > 0
      ? { refreshToken: record.refreshToken }
      : {}),
    ...(typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
      ? { expiresAt: record.expiresAt }
      : {}),
    ...(typeof record.tokenType === 'string' && record.tokenType.length > 0
      ? { tokenType: record.tokenType }
      : {}),
    displayName: typeof record.displayName === 'string' ? record.displayName : null,
    hasPlus: record.hasPlus === true,
    uid: typeof record.uid === 'number' && Number.isFinite(record.uid) ? record.uid : null,
  }
}
