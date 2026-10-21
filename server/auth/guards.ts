import { createPasswordWorkLimiter, type PasswordWorkLimiter } from './passwordWork.ts'
import {
  createLoginRateLimiter,
  createRegisterRateLimiter,
  type LoginRateLimiter,
  type RegisterRateLimiter,
} from './rateLimit.ts'

export type AuthGuards = {
  loginLimiter: LoginRateLimiter
  registerLimiter: RegisterRateLimiter
  passwordWork: PasswordWorkLimiter
}

export function createProductionAuthGuards(): AuthGuards {
  return {
    loginLimiter: createLoginRateLimiter(),
    registerLimiter: createRegisterRateLimiter(),
    passwordWork: createPasswordWorkLimiter(4),
  }
}

/** Высокие пороги для тестов, которым не нужен боевой лимит. */
export function createRelaxedAuthGuards(): AuthGuards {
  return {
    loginLimiter: createLoginRateLimiter({
      accountLimit: 10_000,
      ipLimit: 10_000,
    }),
    registerLimiter: createRegisterRateLimiter({ limit: 10_000 }),
    passwordWork: createPasswordWorkLimiter(8),
  }
}
