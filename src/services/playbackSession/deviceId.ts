/**
 * Стабильный deviceId для привязки persist-ключей к браузеру/устройству.
 */
export const DEVICE_ID_STORAGE_KEY = 'swipe-music-device-id-v1'

export type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dev_${crypto.randomUUID()}`
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Читает или создаёт стабильный deviceId в storage.
 * Не меняет id при повторных вызовах на том же storage.
 */
export function getOrCreateStableDeviceId(storage: StorageLike): string {
  const existing = storage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing && /^dev_[\w-]+$/.test(existing)) {
    return existing
  }
  const created = createDeviceId()
  storage.setItem(DEVICE_ID_STORAGE_KEY, created)
  return created
}

export function isValidDeviceId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 128 &&
    !/\s/.test(value)
  )
}
