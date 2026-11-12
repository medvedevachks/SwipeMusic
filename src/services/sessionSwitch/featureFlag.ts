/**
 * Feature flag SessionSwitchCoordinator ↔ AudioPlayer (PLAYBACK-RELEASE-01).
 *
 * По умолчанию OFF. Ошибка конфигурации — OFF.
 * Production не читает localStorage: включение только решением сервера
 * (`GET /api/runtime-config`, файл `.data/session-switch.flag` или
 * SWIPE_SESSION_SWITCH=1, если файла нет).
 * DEV по-прежнему может включить localStorage-ключом для локальной приёмки.
 */

export const SESSION_SWITCH_INTEGRATION_STORAGE_KEY =
  'swipe-music-session-switch-integration-v1'

export const SESSION_SWITCH_RUNTIME_CONFIG_PATH = '/api/runtime-config'

/** Тестовый override: null = обычное чтение. */
let testOverride: boolean | null = null
/** null = сервер ещё не ответил или ответ не удалось прочитать. */
let serverDecision: boolean | null = null
let productionOverride: boolean | null = null

function isProductionBuild(): boolean {
  if (productionOverride !== null) {
    return productionOverride
  }
  try {
    return import.meta.env?.PROD === true
  } catch {
    return false
  }
}

function devLocalStorageEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false
    }
    return localStorage.getItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isSessionSwitchIntegrationEnabled(): boolean {
  if (testOverride !== null) {
    return testOverride
  }
  if (serverDecision === true) {
    return true
  }
  if (isProductionBuild()) {
    return false
  }
  return devLocalStorageEnabled()
}

export function applySessionSwitchServerDecision(enabled: boolean | null): void {
  serverDecision = enabled === true ? true : enabled === false ? false : null
}

export async function refreshSessionSwitchFromServer(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(SESSION_SWITCH_RUNTIME_CONFIG_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      applySessionSwitchServerDecision(null)
      return isSessionSwitchIntegrationEnabled()
    }
    const body = (await response.json()) as { sessionSwitch?: unknown }
    applySessionSwitchServerDecision(body.sessionSwitch === true)
  } catch {
    applySessionSwitchServerDecision(null)
  }
  return isSessionSwitchIntegrationEnabled()
}

/** Только для тестов. */
export function setSessionSwitchIntegrationEnabledForTests(
  enabled: boolean | null,
): void {
  testOverride = enabled
}

export function setSessionSwitchProductionForTests(
  production: boolean | null,
): void {
  productionOverride = production
}

export function resetSessionSwitchIntegrationFlagForTests(): void {
  testOverride = null
  serverDecision = null
  productionOverride = null
}
