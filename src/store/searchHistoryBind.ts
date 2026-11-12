/**
 * Привязка persisted search history к auth userId.
 * Отдельно от searchStore, чтобы auth/tests не тянули SearchEngine.
 */
import {
  loadRecentSearches,
  saveRecentSearches,
} from './searchHistoryPersistence.ts'

type SearchHistoryHost = {
  setRecentSearches: (items: string[]) => void
}

let host: SearchHistoryHost | null = null
let historyUserId: string | null = null

export function registerSearchHistoryHost(next: SearchHistoryHost): void {
  host = next
}

export function getSearchHistoryUserId(): string | null {
  return historyUserId
}

/** Подставить историю текущего владельца в SearchStore (если host зарегистрирован). */
export function bindSearchHistoryUser(userId: string | null): void {
  historyUserId = userId
  host?.setRecentSearches(loadRecentSearches(userId))
}

export function persistSearchHistory(items: readonly string[]): void {
  saveRecentSearches(historyUserId, items)
}
