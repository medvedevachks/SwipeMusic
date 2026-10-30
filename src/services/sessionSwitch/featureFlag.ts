/**
 * Feature flag интеграции SessionSwitchCoordinator ↔ AudioPlayer (PLAYBACK-DEV-05).
 * По умолчанию выключен. В production-сборке всегда false.
 * При ON (DEV): auth bootstrap SessionStore + CATALOG play через SessionSwitchCoordinator.
 * SEARCH/WAVE/SWIPES/ALBUM остаются на legacy Intent.
 */

export const SESSION_SWITCH_INTEGRATION_STORAGE_KEY =
  'swipe-music-session-switch-integration-v1'

/** Тестовый override: null = читать storage / default. */
let testOverride: boolean | null = null

/**
 * Включена ли контролируемая интеграция session-switch.
 * Production (`import.meta.env.PROD`) — всегда false.
 */
function isProductionBuild(): boolean {
  try {
    return import.meta.env?.PROD === true
  } catch {
    return false
  }
}

export function isSessionSwitchIntegrationEnabled(): boolean {
  if (isProductionBuild()) {
    return false
  }
  if (testOverride !== null) {
    return testOverride
  }
  try {
    if (typeof localStorage === 'undefined') {
      return false
    }
    return localStorage.getItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Только для тестов / DEV-консоли. В PROD no-op на чтение через isEnabled. */
export function setSessionSwitchIntegrationEnabledForTests(
  enabled: boolean | null,
): void {
  testOverride = enabled
}

export function resetSessionSwitchIntegrationFlagForTests(): void {
  testOverride = null
}
