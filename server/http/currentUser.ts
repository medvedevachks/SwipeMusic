import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { createSessionRepository, SESSION_COOKIE } from '../auth/sessions.ts'
import type { AppConfig } from '../config/env.ts'
import { readCookie, serializeClearSessionCookie } from './cookies.ts'

type SessionContext = {
  db: DatabaseSync
  config: AppConfig
}

export function requireUserId(
  req: IncomingMessage,
  res: ServerResponse,
  context: SessionContext,
): string | null {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE)
  if (!token) {
    sendJson(res, 401, { error: 'UNAUTHENTICATED' })
    return null
  }

  const sessions = createSessionRepository(context.db, context.config.sessionTtlMs)
  const session = sessions.findByToken(token)
  if (!session || sessions.isExpired(session)) {
    if (session) {
      sessions.deleteByToken(token)
    }
    res.setHeader('Set-Cookie', serializeClearSessionCookie(context.config))
    sendJson(res, 401, { error: 'UNAUTHENTICATED' })
    return null
  }

  sessions.touch(session.id)
  return session.userId
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('BODY_TOO_LARGE'))
        req.destroy()
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
