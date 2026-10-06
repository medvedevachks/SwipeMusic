import type { ProviderStatusDescriptor } from '../sdk/types'

const DEFAULT_INTERVAL_MS = 200

export function isProviderActionLocked(
  pendingAction: string | null,
  busy: boolean,
  actionId: string,
  actionDisabled = false,
): boolean {
  if (actionDisabled) {
    return true
  }
  if (!busy) {
    return false
  }
  return !(pendingAction === 'login' && actionId === 'logout')
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function refreshUntilSettled<T>(
  operation: Promise<T>,
  refresh: () => Promise<void>,
  options?: {
    intervalMs?: number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<T> {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS
  const sleep = options?.sleep ?? defaultSleep
  let settled = false

  const loop = (async () => {
    while (!settled) {
      await sleep(intervalMs)
      if (settled) {
        return
      }
      try {
        await refresh()
      } catch {
        // Ошибка чтения статуса не должна ронять ожидающий login.
      }
    }
  })()

  try {
    return await operation
  } finally {
    settled = true
    await loop
  }
}

/**
 * Пока login не завершился, публикует свежий descriptor.
 * После ошибки читает статус ещё раз, чтобы не оставить вечный syncing.
 * Отмена (logout во время login) не пробрасывает ошибку login.
 */
export async function watchLoginStatus(options: {
  login: () => Promise<void>
  readStatus: () => Promise<ProviderStatusDescriptor>
  publish: (descriptor: ProviderStatusDescriptor) => void
  isCancelled?: () => boolean
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<void> {
  try {
    await refreshUntilSettled(
      options.login(),
      async () => {
        options.publish(await options.readStatus())
      },
      options,
    )
  } catch (error) {
    try {
      options.publish(await options.readStatus())
    } catch {
      // Если статус уже не прочитать, наружу уходит ошибка login.
    }
    if (options.isCancelled?.()) {
      return
    }
    throw error
  }
}
