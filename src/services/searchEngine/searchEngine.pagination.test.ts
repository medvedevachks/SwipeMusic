import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import {
  mergeAndDedupeSearchResults,
  trackDedupeKey,
  type RankedTrack,
} from './mergeResults.ts'

/**
 * Имитация постраничного накопления как в SearchEngine.searchNext:
 * сохраняем порядок первой выдачи, дописываем unique.
 */
function appendPage(existing: Track[], page: Track[]): Track[] {
  const prior = new Set(existing.map((track) => trackDedupeKey(track)))
  const ranked: RankedTrack[] = page.map((track, resultIndex) => ({
    track,
    sourcePriority: 1,
    sourceOrder: 0,
    resultIndex,
  }))
  const appended = mergeAndDedupeSearchResults(ranked).filter(
    (track) => !prior.has(trackDedupeKey(track)),
  )
  return [...existing, ...appended]
}

function makeTrack(n: number): Track {
  return {
    id: `src:${n}`,
    sourceId: 'src',
    externalId: `e${n}`,
    title: `T${n}`,
    artist: 'Artist',
  }
}

test('incremental pages grow 20 → 40 → 45 without duplicates', () => {
  const page1 = Array.from({ length: 20 }, (_, i) => makeTrack(i))
  const page2 = Array.from({ length: 20 }, (_, i) => makeTrack(i + 20))
  const page3 = [
    ...Array.from({ length: 5 }, (_, i) => makeTrack(i + 40)),
    makeTrack(0), // дубль с первой страницы
  ]

  let results: Track[] = []
  results = appendPage(results, page1)
  assert.equal(results.length, 20)

  results = appendPage(results, page2)
  assert.equal(results.length, 40)

  results = appendPage(results, page3)
  assert.equal(results.length, 45)
  assert.equal(new Set(results.map((t) => t.id)).size, 45)
})

test('empty or fully-duplicate page adds nothing', () => {
  const page1 = Array.from({ length: 20 }, (_, i) => makeTrack(i))
  let results = appendPage([], page1)
  results = appendPage(results, page1)
  assert.equal(results.length, 20)
  results = appendPage(results, [])
  assert.equal(results.length, 20)
})

test('Spotify adapter passes cursor as API offset', () => {
  const spotify = readFileSync(
    new URL('../../sources/adapters/spotify/SpotifyAdapter.ts', import.meta.url),
    'utf8',
  )
  const searchFn = spotify.slice(
    spotify.indexOf('async search('),
    spotify.indexOf('async getTrack('),
  )
  assert.match(searchFn, /params\?\.cursor/)
  assert.match(searchFn, /searchTracks\([\s\S]*offset/)
  assert.match(searchFn, /page\.next/)
})

test('Yandex adapter uses fetched/total paging without fixed page size', () => {
  const yandex = readFileSync(
    new URL(
      '../../sources/adapters/yandex-music/YandexMusicAdapter.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const paging = readFileSync(
    new URL(
      '../../sources/adapters/yandex-music/yandexSearchPaging.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const searchFn = yandex.slice(
    yandex.indexOf('async search('),
    yandex.indexOf('async getTrack('),
  )
  assert.match(searchFn, /resolveYandexSearchExhausted/)
  assert.match(searchFn, /formatYandexSearchCursor/)
  assert.equal(searchFn.includes('pageSizeHint'), false)
  assert.match(paging, /fetchedBefore/)
  assert.match(paging, /не угадываем/)
})

test('SearchEngine searchNext is real and cache keeps cursors', () => {
  const engine = readFileSync(new URL('./SearchEngine.ts', import.meta.url), 'utf8')
  assert.match(engine, /async searchNext\(/)
  assert.equal(engine.includes('return this.state.results\n    }\n\n    // Архитектура готова'), false)
  assert.match(engine, /nextInFlight/)
  assert.match(engine, /SearchCacheEntry/)
  assert.match(engine, /sourceCursors/)
  assert.match(engine, /loadingMore/)
  // Cache hit восстанавливает cursors, а не hasMore=false вслепую.
  assert.match(engine, /cached\.hasMore/)
  assert.match(engine, /cached\.sourceCursors/)
})

test('Search UI and store expose hasMore / loadingMore / load more', () => {
  const page = readFileSync(new URL('../../pages/Search.tsx', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../../store/searchStore.ts', import.meta.url), 'utf8')
  assert.match(store, /loadingMore/)
  assert.match(store, /hasMore/)
  assert.match(store, /searchNext/)
  assert.match(page, /Загрузить ещё/)
  assert.match(page, /IntersectionObserver/)
  assert.match(page, /Больше результатов нет/)
  assert.match(page, /Загружаем ещё/)
  // Play / open-all используют уже загруженный список.
  assert.match(page, /openAllInSwipes\(results/)
  assert.match(page, /playSearchResult\(results/)
})
