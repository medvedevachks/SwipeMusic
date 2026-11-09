/**
 * LIB-06: лёгкая межвкладочная сверка auth без полной sync библиотеки.
 * Cookie общая; epoch/Zustand — in-memory. На focus/visibility или сигнал
 * другой вкладки вызываем /me и при drift применяем тот же путь, что login/logout.
 *
 * LIB-06-HOTFIX-01: ответ /me применяется только если AuthSessionSnapshot
 * всё ещё актуален; иначе игнорируем и при необходимости запускаем повторную сверку.
 */
import { authClient } from './authClient.ts'
import {
  bindAuthSessionEpoch,
  captureAuthSession,
  isAuthSessionCurrent,
} from './sessionEpoch.ts'
import type { AuthUser } from './types.ts'
import { useAuthStore } from '../../store/authStore.ts'
import { getContinuationSession } from '../continuation/ContinuationSession.ts'
import { clearContinuousDiscoveryRuntime } from '../recommendation/continuousSession.ts'
import { invalidateContinuousBuffer } from '../recommendation/continuousBuffer.ts'
import { bindSessionTasteUser } from '../taste/loadSessionTasteProfile.ts'
import { tasteProfileCache } from '../taste/profileCache.ts'

const CHANNEL_NAME = 'sm-auth-epoch'
const AUTH_SYNC_MESSAGE = 'auth-changed'

let installed = false
let revalidateInFlight: Promise<'unchanged' | 'switched' | 'logged_out'> | null =
  null
/** Пока идёт /me, пришёл ещё один запрос сверки — после завершения нужен повтор. */
let revalidateQueued = false

function clearContinuousRuntimeOnAuthChange(): void {
  getContinuationSession().cancel()
  invalidateContinuousBuffer('auth-change')
  clearContinuousDiscoveryRuntime('auth-change')
}

function bindPlaybackSessionsSafe(userId: string | null): void {
  void import('../sessionSwitch/featureFlag.ts')
    .then((flag) => flag.refreshSessionSwitchFromServer())
    .catch(() => false)
    .then(() =>
      import('../sessionSwitch/integration/playbackSessionBootstrap.ts'),
    )
    .then(async (mod) => {
      if (!userId) {
        await mod.teardownPlaybackSessionsForAuth()
        return
      }
      await mod.bindPlaybackSessionsForAuth(userId)
    })
    .catch(() => {
      // Session bootstrap не должен ломать sync
    })
}

/** Применить внешнее auth-состояние (cookie уже соответствует user). */
export function applyExternalAuthUser(user: AuthUser | null): void {
  tasteProfileCache.invalidate()
  bindSessionTasteUser(user?.id ?? null)
  bindAuthSessionEpoch(user?.id ?? null)
  clearContinuousRuntimeOnAuthChange()
  bindPlaybackSessionsSafe(user?.id ?? null)
  useAuthStore.setState({
    user,
    status: user ? 'authenticated' : 'anonymous',
  })
}

export function notifyAuthSessionChanged(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage({ type: AUTH_SYNC_MESSAGE })
    channel.close()
  } catch {
    // BroadcastChannel недоступен — focus/visibility всё равно сверит.
  }
}

async function runAuthSessionRevalidate(): Promise<
  'unchanged' | 'switched' | 'logged_out'
> {
  const before = captureAuthSession()
  let user: AuthUser | null
  try {
    user = await authClient.me()
  } catch {
    return 'unchanged'
  }

  // Локальный login/logout/register (или другая вкладка через apply) сменил поколение —
  // устаревший /me нельзя применять к store / epoch / playback.
  if (!isAuthSessionCurrent(before)) {
    revalidateQueued = true
    return 'unchanged'
  }

  const nextId = user?.id ?? null
  if (before.userId === nextId) {
    return 'unchanged'
  }
  applyExternalAuthUser(user)
  return nextId ? 'switched' : 'logged_out'
}

/** Не async: иначе каждый вызов получит новый wrapper-Promise и coalescing сломается. */
export function revalidateAuthSessionAgainstServer(): Promise<
  'unchanged' | 'switched' | 'logged_out'
> {
  if (revalidateInFlight) {
    revalidateQueued = true
    return revalidateInFlight
  }

  const flight = runAuthSessionRevalidate().finally(() => {
    // Снимаем только свой flight — чужой finally не должен обнулить следующий.
    if (revalidateInFlight === flight) {
      revalidateInFlight = null
    }
    if (revalidateQueued) {
      revalidateQueued = false
      void revalidateAuthSessionAgainstServer()
    }
  })
  revalidateInFlight = flight
  return flight
}

/** Подписка: visibility/focus + BroadcastChannel. Идемпотентна. */
export function installAuthSessionSync(): () => void {
  if (installed || typeof window === 'undefined') {
    return () => undefined
  }
  installed = true

  const onVisible = () => {
    if (document.visibilityState === 'hidden') {
      return
    }
    void revalidateAuthSessionAgainstServer()
  }
  const onFocus = () => {
    void revalidateAuthSessionAgainstServer()
  }

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null
      if (data?.type === AUTH_SYNC_MESSAGE) {
        void revalidateAuthSessionAgainstServer()
      }
    }
  } catch {
    channel = null
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onFocus)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onFocus)
    channel?.close()
    installed = false
  }
}

/** Тесты. */
export function resetAuthSessionSyncForTests(): void {
  installed = false
  revalidateInFlight = null
  revalidateQueued = false
}
