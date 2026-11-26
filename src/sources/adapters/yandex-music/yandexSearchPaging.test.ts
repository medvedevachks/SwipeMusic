import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatYandexSearchCursor,
  parseYandexSearchCursor,
  resolveYandexSearchExhausted,
} from './yandexSearchPaging.ts'

test('parseYandexSearchCursor defaults and round-trip', () => {
  assert.deepEqual(parseYandexSearchCursor(null), { page: 0, fetched: 0 })
  assert.deepEqual(parseYandexSearchCursor('3:60'), { page: 3, fetched: 60 })
  assert.equal(formatYandexSearchCursor(2, 40), '2:40')
})

test('resolveYandexSearchExhausted does not assume page size 20', () => {
  // Короткая первая страница при большом total — НЕ конец.
  assert.equal(
    resolveYandexSearchExhausted({
      tracksOnPage: 7,
      total: 100,
      fetchedBefore: 0,
    }),
    false,
  )
  // Добрали total.
  assert.equal(
    resolveYandexSearchExhausted({
      tracksOnPage: 10,
      total: 100,
      fetchedBefore: 90,
    }),
    true,
  )
  // Пустая страница.
  assert.equal(
    resolveYandexSearchExhausted({
      tracksOnPage: 0,
      total: 100,
      fetchedBefore: 40,
    }),
    true,
  )
  // total неизвестен — только пустая страница завершает.
  assert.equal(
    resolveYandexSearchExhausted({
      tracksOnPage: 15,
      total: 0,
      fetchedBefore: 30,
    }),
    false,
  )
})
