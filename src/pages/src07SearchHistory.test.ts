import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('./Search.tsx', import.meta.url), 'utf8')
const store = readFileSync(
  new URL('../store/searchStore.ts', import.meta.url),
  'utf8',
)
const authStore = readFileSync(
  new URL('../store/authStore.ts', import.meta.url),
  'utf8',
)
const authSync = readFileSync(
  new URL('../services/auth/authSessionSync.ts', import.meta.url),
  'utf8',
)
const bind = readFileSync(
  new URL('../store/searchHistoryBind.ts', import.meta.url),
  'utf8',
)

test('Search UI supports re-run, remove one entry and clear history', () => {
  assert.match(search, /recentSearches/)
  assert.match(search, /Недавние/)
  assert.match(search, /clearHistory/)
  assert.match(search, /Очистить/)
  assert.match(search, /removeRecentSearch/)
  assert.match(search, /void search\(item\)/)
  assert.match(store, /addRecentSearch/)
  assert.match(store, /get\(\)\.addRecentSearch\(nextQuery\)/)
})

test('searchStore persists recentSearches mutations without a second history manager', () => {
  assert.match(store, /persistSearchHistory/)
  assert.match(store, /addRecentSearch/)
  assert.match(store, /removeRecentSearch/)
  assert.match(store, /clearHistory/)
  assert.match(store, /bindSearchHistoryUser\(null\)/)
  assert.equal(store.includes('createSearchHistoryManager'), false)
  assert.equal(store.includes('new SearchHistory'), false)
})

test('auth login/logout/restore rebinds search history owner', () => {
  assert.match(authStore, /bindSearchHistoryUser/)
  assert.match(authSync, /bindSearchHistoryUser/)
  assert.match(bind, /loadRecentSearches/)
  assert.match(bind, /saveRecentSearches|persistSearchHistory|historyUserId/)
})
