/**
 * Persist недавних поисковых запросов в localStorage.
 * Ключ scoped по userId (или anonymous) — без отдельного state manager.
 */

export const SEARCH_HISTORY_STORAGE_PREFIX = 'swipe-music-search-history-v1:'
export const SEARCH_HISTORY_ANONYMOUS_KEY = 'anonymous'
export const SEARCH_HISTORY_MAX = 20

export type SearchHistoryStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function searchHistoryStorageKey(userId: string | null): string {
  const scope =
    userId && userId.trim().length > 0
      ? `user:${userId.trim()}`
      : SEARCH_HISTORY_ANONYMOUS_KEY
  return `${SEARCH_HISTORY_STORAGE_PREFIX}${scope}`
}

export function normalizeRecentSearches(
  input: readonly unknown[],
  max = SEARCH_HISTORY_MAX,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') {
      continue
    }
    const normalized = raw.trim()
    if (!normalized) {
      continue
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(normalized)
    if (out.length >= max) {
      break
    }
  }
  return out
}

let storageOverride: SearchHistoryStorage | null | undefined

/** Только для unit-тестов. `undefined` → снова browser localStorage. */
export function setSearchHistoryStorageForTests(
  storage: SearchHistoryStorage | null | undefined,
): void {
  storageOverride = storage
}

function defaultStorage(): SearchHistoryStorage | null {
  if (storageOverride !== undefined) {
    return storageOverride
  }
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage
  } catch {
    return null
  }
}

export function loadRecentSearches(
  userId: string | null,
  storage: SearchHistoryStorage | null = defaultStorage(),
): string[] {
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(searchHistoryStorageKey(userId))
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return normalizeRecentSearches(parsed)
  } catch {
    return []
  }
}

export function saveRecentSearches(
  userId: string | null,
  queries: readonly string[],
  storage: SearchHistoryStorage | null = defaultStorage(),
): void {
  if (!storage) {
    return
  }
  const normalized = normalizeRecentSearches(queries)
  const key = searchHistoryStorageKey(userId)
  try {
    if (normalized.length === 0) {
      storage.removeItem(key)
      return
    }
    storage.setItem(key, JSON.stringify(normalized))
  } catch {
    // Quota / private mode — история остаётся только в памяти сессии.
  }
}
