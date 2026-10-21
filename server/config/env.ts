import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { canonicalHttpOrigin, PRODUCTION_APP_ORIGIN } from '../http/originPolicy.ts'
import { parseProviderSessionKey } from '../providers/sessionCrypto.ts'

export type MailTransport = 'console' | 'smtp' | 'memory'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export type AppConfig = {
  port: number
  nodeEnv: string
  databasePath: string
  cookieSecure: boolean
  sessionTtlMs: number
  appPublicUrl: string
  mailTransport: MailTransport
  smtp: SmtpConfig | null
  forgotPasswordLimit: number
  forgotPasswordWindowMs: number
  providerSessionKey: Buffer | null
  allowedOrigins: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function readPort(value: string | undefined, fallback: number, name: string): number {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid ${name}`)
  }
  return port
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}`)
  }
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV?.trim() || 'development'
  const mailTransport = (env.MAIL_TRANSPORT?.trim() ||
    (nodeEnv === 'production' ? 'smtp' : 'console')) as MailTransport

  if (
    mailTransport !== 'console' &&
    mailTransport !== 'smtp' &&
    mailTransport !== 'memory'
  ) {
    throw new Error('Mail configuration is invalid')
  }

  if (nodeEnv === 'production' && mailTransport !== 'smtp') {
    throw new Error('Mail configuration is invalid')
  }

  const smtpHost = env.SMTP_HOST?.trim() ?? ''
  const smtpFrom = env.SMTP_FROM?.trim() ?? ''
  const smtp: SmtpConfig | null =
    smtpHost && smtpFrom
      ? {
          host: smtpHost,
          port: readPort(env.SMTP_PORT, 587, 'SMTP_PORT'),
          secure: env.SMTP_SECURE === 'true',
          user: env.SMTP_USER?.trim() ?? '',
          password: env.SMTP_PASSWORD ?? '',
          from: smtpFrom,
        }
      : null

  if (mailTransport === 'smtp' && !smtp) {
    throw new Error('Mail configuration is invalid')
  }

  const appPublicUrl = (env.APP_PUBLIC_URL?.trim() || 'http://127.0.0.1:5173').replace(
    /\/$/,
    '',
  )

  const providerSessionKey = readProviderSessionKey(env, nodeEnv)

  return {
    port: readPort(env.PORT, 8787, 'PORT'),
    nodeEnv,
    databasePath: env.DATABASE_PATH?.trim() || '.data/swipemusic.sqlite',
    cookieSecure: nodeEnv === 'production',
    sessionTtlMs: 30 * DAY_MS,
    appPublicUrl,
    mailTransport,
    smtp,
    forgotPasswordLimit: readPositiveInt(
      env.FORGOT_PASSWORD_LIMIT,
      5,
      'FORGOT_PASSWORD_LIMIT',
    ),
    forgotPasswordWindowMs: readPositiveInt(
      env.FORGOT_PASSWORD_WINDOW_MS,
      15 * MINUTE_MS,
      'FORGOT_PASSWORD_WINDOW_MS',
    ),
    providerSessionKey,
    allowedOrigins: collectAllowedOrigins(env, nodeEnv, appPublicUrl),
  }
}

const DEV_BROWSER_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://127.0.0.1:5173',
  'https://localhost:5173',
]

function collectAllowedOrigins(
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
  appPublicUrl: string,
): string[] {
  const origins = new Set<string>()
  origins.add(PRODUCTION_APP_ORIGIN)
  const configured = canonicalHttpOrigin(appPublicUrl)
  if (configured) {
    origins.add(configured)
  }
  if (nodeEnv !== 'production') {
    for (const origin of DEV_BROWSER_ORIGINS) {
      origins.add(origin)
    }
    const lanOrigin = readDevelopmentLanOrigin(nodeEnv)
    if (lanOrigin) {
      origins.add(lanOrigin)
    }
  }
  for (const origin of parseExtraOrigins(env.APP_ALLOWED_ORIGINS)) {
    origins.add(origin)
  }
  return [...origins]
}

function parseExtraOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return []
  }
  return raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0).map((item) => {
    if (item.includes('*')) {
      throw new Error('APP_ALLOWED_ORIGINS is invalid')
    }
    const origin = canonicalHttpOrigin(item)
    if (!origin) {
      throw new Error('APP_ALLOWED_ORIGINS is invalid')
    }
    return origin
  })
}

function readDevelopmentLanOrigin(nodeEnv: string): string | null {
  if (nodeEnv !== 'development') {
    return null
  }
  const path = join(process.cwd(), '.certs', 'lan-origin.txt')
  if (!existsSync(path)) {
    return null
  }
  const text = readFileSync(path, 'utf8').trim()
  const origin = canonicalHttpOrigin(text)
  if (!origin) {
    return null
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.port !== '5173' || isIP(url.hostname) !== 4) {
    return null
  }
  return origin
}

function readProviderSessionKey(env: NodeJS.ProcessEnv, nodeEnv: string): Buffer | null {
  const raw = env.PROVIDER_SESSION_KEY?.trim() ?? ''
  if (raw) {
    return parseProviderSessionKey(raw)
  }
  if (nodeEnv === 'production') {
    throw new Error('PROVIDER_SESSION_KEY is invalid')
  }
  return null
}
