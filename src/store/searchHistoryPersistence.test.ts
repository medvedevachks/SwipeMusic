import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../services/auth/sessionEpoch.ts'
import {
  bindSearchHistoryUser,
  captureSearchHistoryAuthSession,
  commitRecentSearchIfAuthCurrent,
  getSearchHistoryUserId,
  persistSearchHistory,
  registerSearchHistoryHost,
} from './searchHistoryBind.ts'
import {
  loadRecentSearches,
  normalizeRecentSearches,
  saveRecentSearches,
  searchHistoryStorageKey,
  setSearchHistoryStorageForTests,
  type SearchHistoryStorage,
} from './searchHistoryPersistence.ts'

function memoryStorage(): SearchHistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

test('normalizeRecentSearches trims, dedupes case-insensitively and caps length', () => {
  assert.deepEqual(
    normalizeRecentSearches(['  Splin ', 'splin', '', 'Ария', 'АРИЯ', 'x'], 3),
    ['Splin', 'Ария', 'x'],
  )
})

test('search history persists per user and survives reload from storage', () => {
  const storage = memoryStorage()
  saveRecentSearches('user-a', ['Сплин', 'Кино'], storage)
  saveRecentSearches('user-b', ['БИ-2'], storage)
  saveRecentSearches(null, ['guest'], storage)

  assert.deepEqual(loadRecentSearches('user-a', storage), ['Сплин', 'Кино'])
  assert.deepEqual(loadRecentSearches('user-b', storage), ['БИ-2'])
  assert.deepEqual(loadRecentSearches(null, storage), ['guest'])
  assert.notEqual(
    searchHistoryStorageKey('user-a'),
    searchHistoryStorageKey('user-b'),
  )
  assert.notEqual(
    searchHistoryStorageKey('user-a'),
    searchHistoryStorageKey(null),
  )
})

test('clearing history removes storage key for that owner only', () => {
  const storage = memoryStorage()
  saveRecentSearches('user-a', ['one'], storage)
  saveRecentSearches('user-b', ['two'], storage)
  saveRecentSearches('user-a', [], storage)
  assert.equal(storage.data.has(searchHistoryStorageKey('user-a')), false)
  assert.deepEqual(loadRecentSearches('user-b', storage), ['two'])
})

test('bindSearchHistoryUser isolates in-memory host between users', () => {
  const storage = memoryStorage()
  setSearchHistoryStorageForTests(storage)
  let recent: string[] = []
  registerSearchHistoryHost({
    setRecentSearches: (items) => {
      recent = [...items]
    },
  })

  try {
    bindSearchHistoryUser('user-a')
    persistSearchHistory(['A1', 'A2'])
    assert.equal(getSearchHistoryUserId(), 'user-a')
    assert.deepEqual(loadRecentSearches('user-a', storage), ['A1', 'A2'])

    bindSearchHistoryUser('user-b')
    assert.deepEqual(recent, [])
    persistSearchHistory(['B1'])
    assert.deepEqual(loadRecentSearches('user-b', storage), ['B1'])
    assert.deepEqual(loadRecentSearches('user-a', storage), ['A1', 'A2'])

    bindSearchHistoryUser('user-a')
    assert.deepEqual(recent, ['A1', 'A2'])

    bindSearchHistoryUser(null)
    assert.deepEqual(recent, [])
    persistSearchHistory(['guest'])
    assert.deepEqual(loadRecentSearches(null, storage), ['guest'])
    assert.deepEqual(loadRecentSearches('user-a', storage), ['A1', 'A2'])
  } finally {
    setSearchHistoryStorageForTests(undefined)
    bindSearchHistoryUser(null)
  }
})

test('completed search does not write history after auth session changes', () => {
  const storage = memoryStorage()
  setSearchHistoryStorageForTests(storage)
  let recent: string[] = []
  registerSearchHistoryHost({
    setRecentSearches: (items) => {
      recent = [...items]
    },
  })
  resetAuthSessionEpochForTests()

  try {
    bindAuthSessionEpoch('user-a')
    bindSearchHistoryUser('user-a')
    persistSearchHistory(['A-before'])
    const sessionAtSearchStart = captureSearchHistoryAuthSession()

    bindAuthSessionEpoch('user-b')
    bindSearchHistoryUser('user-b')
    persistSearchHistory(['B-own'])
    assert.deepEqual(loadRecentSearches('user-b', storage), ['B-own'])
    assert.deepEqual(recent, [])

    const committed = commitRecentSearchIfAuthCurrent(
      sessionAtSearchStart,
      () => {
        persistSearchHistory(['leaked-from-a-search'])
        recent = ['leaked-from-a-search']
      },
    )

    assert.equal(committed, false)
    assert.deepEqual(loadRecentSearches('user-a', storage), ['A-before'])
    assert.deepEqual(loadRecentSearches('user-b', storage), ['B-own'])
    assert.deepEqual(recent, [])

    const sameSession = captureSearchHistoryAuthSession()
    const ok = commitRecentSearchIfAuthCurrent(sameSession, () => {
      persistSearchHistory(['B-search'])
      recent = ['B-search']
    })
    assert.equal(ok, true)
    assert.deepEqual(loadRecentSearches('user-b', storage), ['B-search'])
    assert.deepEqual(loadRecentSearches('user-a', storage), ['A-before'])
    assert.deepEqual(recent, ['B-search'])
  } finally {
    setSearchHistoryStorageForTests(undefined)
    resetAuthSessionEpochForTests()
    bindSearchHistoryUser(null)
  }
})
