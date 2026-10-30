/**
 * Поколение auth-сессии: растёт на login / logout / register / restore.
 * Одинаковый userId при повторном входе — новое поколение.
 */

export type AuthSessionSnapshot = {
  generation: number
  userId: string | null
}

let generation = 0
let sessionUserId: string | null = null

export function bindAuthSessionEpoch(userId: string | null): void {
  generation += 1
  sessionUserId = userId
}

export function captureAuthSession(): AuthSessionSnapshot {
  return { generation, userId: sessionUserId }
}

export function isAuthSessionCurrent(snapshot: AuthSessionSnapshot): boolean {
  return (
    snapshot.generation === generation && snapshot.userId === sessionUserId
  )
}

export class StaleLibrarySessionError extends Error {
  constructor(message = 'LIBRARY_SESSION_STALE') {
    super(message)
    this.name = 'StaleLibrarySessionError'
  }
}

/** Тесты. */
export function resetAuthSessionEpochForTests(): void {
  generation = 0
  sessionUserId = null
}
