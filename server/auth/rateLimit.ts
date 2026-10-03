export type ForgotPasswordLimiter = {
  consume(ip: string, email: string): boolean
}

/**
 * Память процесса. После перезапуска сервера счётчики обнуляются.
 * Это ограничение single-instance MVP, не общий Redis.
 */
export function createForgotPasswordLimiter(
  limit: number,
  windowMs: number,
): ForgotPasswordLimiter {
  const hits = new Map<string, number[]>()

  return {
    consume(ip: string, email: string): boolean {
      const key = `${ip}|${email}`
      const now = Date.now()
      const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(now)
      hits.set(key, recent)
      return true
    },
  }
}
