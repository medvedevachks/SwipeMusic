import { createServer, type Server } from 'node:http'
import {
  createLoginRateLimiter,
  createRegisterRateLimiter,
  type ForgotPasswordLimiter,
  type LoginRateLimiter,
  type RegisterRateLimiter,
} from '../auth/rateLimit.ts'
import { createPasswordWorkLimiter, type PasswordWorkLimiter } from '../auth/passwordWork.ts'
import type { MailSender } from '../mail/MailSender.ts'
import { handleAuthRequest } from './authRoutes.ts'
import { handleLibraryRequest } from './libraryRoutes.ts'
import {
  handleYandexMusicProxy,
  handleYandexProviderRequest,
  type YandexRouteContext,
} from './yandexRoutes.ts'
import { handleHealth, handleYandexFetchProxy, handleYandexOauthProxy } from './yandexEdge.ts'
import type { HostResolver } from './yandexFetchPolicy.ts'
import type { YandexUpstream } from '../providers/yandexSession.ts'

export type AuthServerOptions = YandexRouteContext & {
  mail: MailSender
  limiter: ForgotPasswordLimiter
  loginLimiter?: LoginRateLimiter
  registerLimiter?: RegisterRateLimiter
  passwordWork?: PasswordWorkLimiter
  yandexOauthUpstream?: YandexUpstream
  yandexMetadataUpstream?: YandexUpstream
  resolveMetadataHost?: HostResolver
}

export function createAuthServer(options: AuthServerOptions): Server {
  const loginLimiter = options.loginLimiter ?? createLoginRateLimiter()
  const registerLimiter = options.registerLimiter ?? createRegisterRateLimiter()
  const passwordWork = options.passwordWork ?? createPasswordWorkLimiter(4)
  const authOptions = { ...options, loginLimiter, registerLimiter, passwordWork }

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const { pathname } = url
    const handler = pathname === '/api/health'
      ? Promise.resolve(handleHealth(req, res))
      : pathname.startsWith('/api/yandex-oauth')
        ? handleYandexOauthProxy(req, res, options)
        : pathname === '/api/yandex-fetch'
          ? handleYandexFetchProxy(req, res, options)
          : pathname.startsWith('/api/yandex-music')
            ? handleYandexMusicProxy(req, res, options)
            : pathname.startsWith('/api/me/providers/')
              ? handleYandexProviderRequest(req, res, options)
              : pathname.startsWith('/api/me')
                ? handleLibraryRequest(req, res, options)
                : handleAuthRequest(req, res, authOptions)

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
