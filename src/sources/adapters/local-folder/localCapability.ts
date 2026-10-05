export type LocalCapabilityBlocker =
  | 'insecure-context'
  | 'directory-picker-missing'
  | 'indexed-db-missing'
  | 'object-url-missing'

export type LocalCapabilityEnvironment = {
  isSecureContext: boolean
  hasDirectoryPicker: boolean
  hasIndexedDb: boolean
  hasObjectUrl: boolean
}

export type LocalCapability = {
  supported: boolean
  blocker: LocalCapabilityBlocker | null
  message: string | null
}

const MESSAGES: Record<LocalCapabilityBlocker, string> = {
  'insecure-context': 'Нужен secure context / HTTPS.',
  'directory-picker-missing': 'Directory picker недоступен.',
  'indexed-db-missing': 'IndexedDB недоступен.',
  'object-url-missing': 'Локальный адрес файла недоступен.',
}

/** Проверка возможности Local Files. Разрешение не запрашивается. */
export function assessLocalCapability(
  environment: LocalCapabilityEnvironment,
): LocalCapability {
  const blocker = blockerFor(environment)
  if (!blocker) {
    return { supported: true, blocker: null, message: null }
  }
  return { supported: false, blocker, message: MESSAGES[blocker] }
}

export function readLocalCapability(): LocalCapability {
  const hasWindow = typeof window !== 'undefined'
  return assessLocalCapability({
    isSecureContext: hasWindow ? window.isSecureContext === true : false,
    hasDirectoryPicker:
      hasWindow && typeof window.showDirectoryPicker === 'function',
    hasIndexedDb: typeof indexedDB !== 'undefined',
    hasObjectUrl:
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function',
  })
}

function blockerFor(
  environment: LocalCapabilityEnvironment,
): LocalCapabilityBlocker | null {
  if (!environment.isSecureContext) {
    return 'insecure-context'
  }
  if (!environment.hasDirectoryPicker) {
    return 'directory-picker-missing'
  }
  if (!environment.hasIndexedDb) {
    return 'indexed-db-missing'
  }
  if (!environment.hasObjectUrl) {
    return 'object-url-missing'
  }
  return null
}
