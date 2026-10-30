/**
 * Синхронный pending-like intent для LEFT → UP race.
 * Привязан к auth session epoch: finally сессии A не снимает pending сессии B.
 */
import {
  captureAuthSession,
  isAuthSessionCurrent,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'

type PendingSlot = {
  generation: number
  userId: string | null
  count: number
}

const pendingByKey = new Map<string, PendingSlot>()

/**
 * Регистрирует intent в текущей сессии.
 * Возвращает снимок для парного endPendingSwipeLike.
 */
export function beginPendingSwipeLike(
  sourceTrackKey: string,
): AuthSessionSnapshot {
  const session = captureAuthSession()
  if (!sourceTrackKey) {
    return session
  }
  const current = pendingByKey.get(sourceTrackKey)
  if (
    current &&
    current.generation === session.generation &&
    current.userId === session.userId
  ) {
    current.count += 1
  } else {
    pendingByKey.set(sourceTrackKey, {
      generation: session.generation,
      userId: session.userId,
      count: 1,
    })
  }
  return session
}

/** True только если pending принадлежит текущей auth-сессии. */
export function hasPendingSwipeLike(sourceTrackKey: string): boolean {
  const current = pendingByKey.get(sourceTrackKey)
  if (!current || current.count <= 0) {
    return false
  }
  return isAuthSessionCurrent({
    generation: current.generation,
    userId: current.userId,
  })
}

/**
 * Снимает intent только если session совпадает со слотом.
 * Чужой/устаревший finally (после logout → login) — no-op.
 */
export function endPendingSwipeLike(
  sourceTrackKey: string,
  session: AuthSessionSnapshot,
): void {
  const current = pendingByKey.get(sourceTrackKey)
  if (!current) {
    return
  }
  if (
    current.generation !== session.generation ||
    current.userId !== session.userId
  ) {
    return
  }
  const next = current.count - 1
  if (next <= 0) {
    pendingByKey.delete(sourceTrackKey)
    return
  }
  current.count = next
}

/** Logout / смена сессии / тесты. */
export function clearPendingSwipeLikes(): void {
  pendingByKey.clear()
}

export function resetPendingSwipeLikesForTests(): void {
  clearPendingSwipeLikes()
}
