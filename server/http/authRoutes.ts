import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../auth/password.ts'
import { PasswordBusyError, type PasswordWorkLimiter } from '../auth/passwordWork.ts'
import { createPasswordResetRepository } from '../auth/passwordReset.ts'
import type {
  ForgotPasswordLimiter,
  LoginRateLimiter,
  RegisterRateLimiter,
} from '../auth/rateLimit.ts'
import {
  createSessionRepository,
  SESSION_COOKIE,
} from '../auth/sessions.ts'
import {
  createUserRepository,
  isUniqueConstraintError,
  toPublicUser,
} from '../auth/users.ts'
import {
  validateForgotPassword,
  validateLogin,
  validateRegister,
  validateResetPassword,
} from '../auth/validation.ts'
import type { AppConfig } from '../config/env.ts'
import type { MailSender } from '../mail/MailSender.ts'
import { resolveClientIp } from './clientIp.ts'
import {
  readCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from './cookies.ts'

export const FORGOT_PASSWORD_MESSAGE =
  'Если аккаунт с такой почтой существует, инструкция отправлена.'

type AuthContext = {
  db: DatabaseSync
  config: AppConfig
  mail: MailSender
  limiter: ForgotPasswordLimiter
  loginLimiter: LoginRateLimiter
  registerLimiter: RegisterRateLimiter
  passwordWork: PasswordWorkLimiter
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

function sendRateLimited(res: ServerResponse, retryAfterSeconds: number): void {
  sendJson(res, 429, { error: 'RATE_LIMITED' }, {
    'Retry-After': String(retryAfterSeconds),
  })
}

function sendBusy(res: ServerResponse): void {
  sendJson(res, 503, { error: 'BUSY' }, { 'Retry-After': '1' })
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        req.pause()
        reject(new Error('BODY_TOO_LARGE'))
        setImmediate(() => {
          req.destroy()
        })
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as unknown)
      } catch {
        reject(new Error('BAD_JSON'))
      }
    })

    req.on('error', reject)
  })
}

function sessionToken(req: IncomingMessage): string | null {
  return readCookie(req.headers.cookie, SESSION_COOKIE)
}

function clientIp(req: IncomingMessage): string {
  return resolveClientIp(req.socket.remoteAddress, req.headers)
}

export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: AuthContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (!path.startsWith('/api/auth')) {
    sendJson(res, 404, { error: 'NOT_FOUND' })
    return
  }

  const users = createUserRepository(context.db)
  const sessions = createSessionRepository(context.db, context.config.sessionTtlMs)
  const resets = createPasswordResetRepository(context.db)

  if (method === 'POST' && path === '/api/auth/register') {
    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
      return
    }

    const parsed = validateRegister(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }

    const registration = context.registerLimiter.consume(clientIp(req))
    if (!registration.allowed) {
      sendRateLimited(res, registration.retryAfterSeconds)
      return
    }

    let passwordHash: string
    try {
      passwordHash = await hashPassword(parsed.value.password, context.passwordWork)
    } catch (error) {
      if (error instanceof PasswordBusyError) {
        sendBusy(res)
        return
      }
      throw error
    }

    try {
      const user = users.create(parsed.value, passwordHash)
      const { token } = sessions.create(user.id)
      res.setHeader('Set-Cookie', serializeSessionCookie(token, context.config))
      sendJson(res, 201, { user: toPublicUser(user) })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        sendJson(res, 409, { error: 'EMAIL_TAKEN' })
        return
      }
      throw error
    }
    return
  }

  if (method === 'POST' && path === '/api/auth/login') {
    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
      return
    }

    const parsed = validateLogin(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }

    const loginAttempt = context.loginLimiter.consume(clientIp(req), parsed.value.email)
    if (!loginAttempt.allowed) {
      sendRateLimited(res, loginAttempt.retryAfterSeconds)
      return
    }

    const user = users.findByEmail(parsed.value.email)
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH
    let passwordOk = false
    try {
      passwordOk = await verifyPassword(parsed.value.password, hash, context.passwordWork)
    } catch (error) {
      if (error instanceof PasswordBusyError) {
        sendBusy(res)
        return
      }
      throw error
    }
    if (!user || !passwordOk) {
      sendJson(res, 401, { error: 'INVALID_CREDENTIALS' })
      return
    }

    const { token } = sessions.create(user.id)
    res.setHeader('Set-Cookie', serializeSessionCookie(token, context.config))
    sendJson(res, 200, { user: toPublicUser(user) })
    return
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const token = sessionToken(req)
    if (token) {
      sessions.deleteByToken(token)
    }
    res.setHeader('Set-Cookie', serializeClearSessionCookie(context.config))
    sendJson(res, 200, { ok: true })
    return
  }

  if (method === 'POST' && path === '/api/auth/forgot-password') {
    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
      return
    }

    const parsed = validateForgotPassword(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }

    const allowed = context.limiter.consume(clientIp(req), parsed.value.email)
    if (!allowed) {
      sendJson(res, 429, { error: 'RATE_LIMITED' })
      return
    }

    const user = users.findByEmail(parsed.value.email)
    if (user) {
      const { token } = resets.issue(user.id)
      const resetUrl = `${context.config.appPublicUrl}/reset-password?token=${encodeURIComponent(token)}`
      try {
        await context.mail.sendPasswordReset({
          to: user.email,
          resetUrl,
        })
      } catch {
        console.error('password reset mail failed')
      }
    }

    sendJson(res, 200, { message: FORGOT_PASSWORD_MESSAGE })
    return
  }

  if (method === 'POST' && path === '/api/auth/reset-password') {
    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
      return
    }

    const parsed = validateResetPassword(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }

    const reset = resets.findByToken(parsed.value.token)
    if (!reset || !resets.isUsable(reset)) {
      sendJson(res, 400, { error: 'INVALID_RESET_TOKEN' })
      return
    }

    let passwordHash: string
    try {
      passwordHash = await hashPassword(parsed.value.password, context.passwordWork)
    } catch (error) {
      if (error instanceof PasswordBusyError) {
        sendBusy(res)
        return
      }
      throw error
    }

    context.db.exec('BEGIN')
    try {
      const marked = resets.markUsed(reset.id)
      if (!marked) {
        context.db.exec('ROLLBACK')
        sendJson(res, 400, { error: 'INVALID_RESET_TOKEN' })
        return
      }
      users.updatePassword(reset.userId, passwordHash)
      sessions.deleteAllForUser(reset.userId)
      context.db.exec('COMMIT')
    } catch (error) {
      context.db.exec('ROLLBACK')
      throw error
    }

    sendJson(res, 200, { ok: true })
    return
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const token = sessionToken(req)
    if (!token) {
      sendJson(res, 401, { error: 'UNAUTHENTICATED' })
      return
    }

    const session = sessions.findByToken(token)
    if (!session || sessions.isExpired(session)) {
      if (session) {
        sessions.deleteByToken(token)
      }
      res.setHeader('Set-Cookie', serializeClearSessionCookie(context.config))
      sendJson(res, 401, { error: 'UNAUTHENTICATED' })
      return
    }

    const user = users.findById(session.userId)
    if (!user) {
      sessions.deleteByToken(token)
      res.setHeader('Set-Cookie', serializeClearSessionCookie(context.config))
      sendJson(res, 401, { error: 'UNAUTHENTICATED' })
      return
    }

    sessions.touch(session.id)
    sendJson(res, 200, { user: toPublicUser(user) })
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}
