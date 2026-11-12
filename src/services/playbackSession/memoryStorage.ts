import type { StorageLike } from './deviceId.ts'

/** In-memory StorageLike для unit-тестов. */
export function createMemoryStorage(seed?: Map<string, string>): StorageLike & {
  data: Map<string, string>
  failNextSetItem?: Error | null
} {
  const data = seed ?? new Map<string, string>()
  const api = {
    data,
    failNextSetItem: null as Error | null,
    getItem(key: string): string | null {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      if (api.failNextSetItem) {
        const err = api.failNextSetItem
        api.failNextSetItem = null
        throw err
      }
      data.set(key, value)
    },
    removeItem(key: string): void {
      data.delete(key)
    },
  }
  return api
}
