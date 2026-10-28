export const LOGIN_ACCOUNT_LIMIT = 5
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_IP_LIMIT = 30
export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000
export const REGISTER_IP_LIMIT = 5
export const REGISTER_IP_WINDOW_MS = 60 * 60 * 1000
export const AUTH_LIMIT_MAX_KEYS = 10_000

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export type ForgotPasswordLimiter = {
  consume(ip: string, email: string): boolean
}

export type LoginRateLimiter = {
  consume(ip: string, email: string): RateLimitDecision
}

export type RegisterRateLimiter = {
  consume(ip: string): RateLimitDecision
}

type Clock = () => number

type WindowOptions = {
  limit: number
  windowMs: number
  now: Clock
  maxKeys: number
}

/**
 * Счётчики живут в памяти одного процесса Node.
 * Перезапуск обнуляет их. Второй процесс или другой хост их не видит.
 * Это ограничение single-instance, не общий Redis.
 * Устаревшие отметки удаляются, а число ключей ограничено:
 * при переполнении самые старые корзины вытесняются, и лимит по ним начинается заново.
 */
function createHitWindow(options: WindowOptions) {
  const hits = new Map<string, number[]>()
  let operations = 0

  function prune(now: number): void {
    for (const [key, stamps] of hits) {
      const recent = stamps.filter((stamp) => now - stamp < options.windowMs)
      if (recent.length === 0) {
        hits.delete(key)
      } else if (recent.length !== stamps.length) {
        hits.set(key, recent)
      }
    }
  }

  function evictOldest(): void {
    while (hits.size > options.maxKeys) {
      let oldestKey: string | null = null
      let oldestStamp = Number.POSITIVE_INFINITY
      for (const [key, stamps] of hits) {
        const stamp = stamps[0] ?? 0
        if (stamp < oldestStamp) {
          oldestStamp = stamp
          oldestKey = key
        }
      }
      if (oldestKey === null) {
        return
      }
      hits.delete(oldestKey)
    }
  }

  function sweep(now: number, force: boolean): void {
    operations += 1
    if (!force && hits.size <= options.maxKeys && operations % 64 !== 0) {
      return
    }
    prune(now)
    evictOldest()
  }

  return {
    inspect(key: string, now: number): {
      recent: number[]
      blocked: boolean
      retryAfterSeconds: number
    } {
      const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < options.windowMs)
      if (recent.length >= options.limit) {
        const oldest = recent[0] ?? now
        hits.set(key, recent)
        return {
          recent,
          blocked: true,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)),
        }
      }
      return { recent, blocked: false, retryAfterSeconds: 0 }
    },
    commit(key: string, recent: number[], now: number): void {
      recent.push(now)
      hits.set(key, recent)
      sweep(now, hits.size > options.maxKeys)
    },
  }
}

function denied(retryAfterSeconds: number): RateLimitDecision {
  return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) }
}

export function createForgotPasswordLimiter(
  limit: number,
  windowMs: number,
  now: Clock = Date.now,
): ForgotPasswordLimiter {
  const window = createHitWindow({
    limit,
    windowMs,
    now,
    maxKeys: AUTH_LIMIT_MAX_KEYS,
  })

  return {
    consume(ip: string, email: string): boolean {
      const current = now()
      const key = `${ip}|${email}`
      const decision = window.inspect(key, current)
      if (decision.blocked) {
        return false
      }
      window.commit(key, decision.recent, current)
      return true
    },
  }
}

export function createLoginRateLimiter(
  options: {
    accountLimit?: number
    accountWindowMs?: number
    ipLimit?: number
    ipWindowMs?: number
    maxKeys?: number
    now?: Clock
  } = {},
): LoginRateLimiter {
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? AUTH_LIMIT_MAX_KEYS
  const accountWindow = createHitWindow({
    limit: options.accountLimit ?? LOGIN_ACCOUNT_LIMIT,
    windowMs: options.accountWindowMs ?? LOGIN_ACCOUNT_WINDOW_MS,
    now,
    maxKeys,
  })
  const ipWindow = createHitWindow({
    limit: options.ipLimit ?? LOGIN_IP_LIMIT,
    windowMs: options.ipWindowMs ?? LOGIN_IP_WINDOW_MS,
    now,
    maxKeys,
  })

  return {
    consume(ip: string, email: string): RateLimitDecision {
      const current = now()
      const normalizedEmail = email.trim().toLowerCase()
      const accountKey = `${ip}\n${normalizedEmail}`
      const account = accountWindow.inspect(accountKey, current)
      const network = ipWindow.inspect(ip, current)
      if (account.blocked || network.blocked) {
        return denied(Math.max(account.retryAfterSeconds, network.retryAfterSeconds))
      }
      accountWindow.commit(accountKey, account.recent, current)
      ipWindow.commit(ip, network.recent, current)
      return { allowed: true }
    },
  }
}

export const TASTE_PROFILE_LIMIT = 30
export const TASTE_PROFILE_WINDOW_MS = 60 * 1000

export type TasteProfileLimiter = {
  consume(userId: string): RateLimitDecision
}

export function createTasteProfileLimiter(
  options: { limit?: number; windowMs?: number; now?: Clock } = {},
): TasteProfileLimiter {
  const now = options.now ?? Date.now
  const window = createHitWindow({
    limit: options.limit ?? TASTE_PROFILE_LIMIT,
    windowMs: options.windowMs ?? TASTE_PROFILE_WINDOW_MS,
    now,
    maxKeys: AUTH_LIMIT_MAX_KEYS,
  })

  return {
    consume(userId: string): RateLimitDecision {
      const current = now()
      const decision = window.inspect(userId, current)
      if (decision.blocked) {
        return denied(decision.retryAfterSeconds)
      }
      window.commit(userId, decision.recent, current)
      return { allowed: true }
    },
  }
}

export function createRegisterRateLimiter(
  options: {
    limit?: number
    windowMs?: number
    maxKeys?: number
    now?: Clock
  } = {},
): RegisterRateLimiter {
  const now = options.now ?? Date.now
  const window = createHitWindow({
    limit: options.limit ?? REGISTER_IP_LIMIT,
    windowMs: options.windowMs ?? REGISTER_IP_WINDOW_MS,
    now,
    maxKeys: options.maxKeys ?? AUTH_LIMIT_MAX_KEYS,
  })

  return {
    consume(ip: string): RateLimitDecision {
      const current = now()
      const decision = window.inspect(ip, current)
      if (decision.blocked) {
        return denied(decision.retryAfterSeconds)
      }
      window.commit(ip, decision.recent, current)
      return { allowed: true }
    },
  }
}
