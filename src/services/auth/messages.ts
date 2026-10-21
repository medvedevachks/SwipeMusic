import { AuthApiError } from './types.ts'

export const TOO_MANY_ATTEMPTS_MESSAGE = 'Слишком много попыток. Попробуйте позже.'

export function authRateLimitMessage(error: unknown): string | null {
  if (error instanceof AuthApiError && error.code === 'RATE_LIMITED') {
    return TOO_MANY_ATTEMPTS_MESSAGE
  }
  return null
}

export function authFormError(error: unknown): string {
  if (error instanceof Error && error.message === 'Failed to fetch') {
    return 'Не удалось связаться с сервером'
  }
  return 'Не удалось выполнить запрос'
}
