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
  }
}
