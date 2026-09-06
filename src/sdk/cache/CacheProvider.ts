export type CacheGetOptions = {
  /** Максимальный возраст записи в ms; просроченные считаются miss. */
  maxAgeMs?: number
}

export type CacheSetOptions = {
  /** TTL в ms (для провайдеров, которые его поддерживают). */
  ttlMs?: number
}

/**
 * Универсальный кэш для плагинов.
 */
export interface CacheProvider {
  get<T>(key: string, options?: CacheGetOptions): Promise<T | null>
  set(key: string, value: unknown, options?: CacheSetOptions): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
