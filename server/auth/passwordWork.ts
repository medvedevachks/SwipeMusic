export class PasswordBusyError extends Error {
  constructor() {
    super('PASSWORD_BUSY')
    this.name = 'PasswordBusyError'
  }
}

export type PasswordWorkLimiter = {
  run<T>(operation: () => Promise<T>): Promise<T>
}

/**
 * Ограничивает число одновременно выполняющихся scrypt.
 * Лишняя операция отклоняется сразу и не ставится в очередь libuv.
 */
export function createPasswordWorkLimiter(maxConcurrent: number): PasswordWorkLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error('Password work limit is invalid')
  }

  let active = 0

  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active >= maxConcurrent) {
        throw new PasswordBusyError()
      }
      active += 1
      try {
        return await operation()
      } finally {
        active -= 1
      }
    },
  }
}
