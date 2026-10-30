/**
 * Привязка фоновых CME-операций к SessionSwitch epoch (DEV-08).
 * Stale refill/advance не пишет в live queue чужой сессии.
 */
import type { PlaybackSessionId } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type CmeOwnedSessionId = Extract<
  PlaybackSessionId,
  'swipes' | 'wave' | 'search'
>

export type CmeSessionOwnershipToken = {
  sessionId: CmeOwnedSessionId
  switchEpoch: number
}

let ownership: CmeSessionOwnershipToken | null = null

export function bindCmeSessionOwnership(
  token: CmeSessionOwnershipToken,
): void {
  ownership = { ...token }
}

export function clearCmeSessionOwnership(): void {
  ownership = null
}

export function getCmeSessionOwnership(): CmeSessionOwnershipToken | null {
  return ownership ? { ...ownership } : null
}

export function resetCmeSessionOwnershipForTests(): void {
  ownership = null
}

/**
 * Разрешена ли мутация live PlaybackQueue из CME (insertNext и т.п.).
 * Flag OFF / нет runtime → true (legacy).
 */
export function isCmeLiveMutationAllowed(): boolean {
  if (!isSessionSwitchIntegrationEnabled()) {
    return true
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return true
  }
  if (!ownership) {
    return false
  }
  if (runtime.store.getActiveSessionId() !== ownership.sessionId) {
    return false
  }
  if (runtime.store.getSwitchEpoch() !== ownership.switchEpoch) {
    return false
  }
  return true
}

/** После успешного switch в recommendation-сессию. */
export function bindCmeOwnershipFromRuntime(
  sessionId: CmeOwnedSessionId,
): void {
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    clearCmeSessionOwnership()
    return
  }
  bindCmeSessionOwnership({
    sessionId,
    switchEpoch: runtime.store.getSwitchEpoch(),
  })
}
