import { createServer, type Server } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { ForgotPasswordLimiter } from '../auth/rateLimit.ts'
import type { AppConfig } from '../config/env.ts'
import type { MailSender } from '../mail/MailSender.ts'
import { handleAuthRequest } from './authRoutes.ts'
import { handleLibraryRequest } from './libraryRoutes.ts'

export type AuthServerOptions = {
  db: DatabaseSync
  config: AppConfig
  mail: MailSender
  limiter: ForgotPasswordLimiter
}

export function createAuthServer(options: AuthServerOptions): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const handler = url.pathname.startsWith('/api/me')
      ? handleLibraryRequest(req, res, options)
      : handleAuthRequest(req, res, options)

    void handler.catch((error: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      const message = error instanceof Error ? error.name : 'Error'
      console.error(`auth request failed: ${message}`)
      const payload = JSON.stringify({ error: 'INTERNAL' })
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(payload)
    })
  })
}

export function listenAuthServer(options: AuthServerOptions): Promise<Server> {
  const server = createAuthServer(options)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.config.port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
