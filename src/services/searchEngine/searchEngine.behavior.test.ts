import assert from 'node:assert/strict'
import test from 'node:test'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter.ts'
import type { Track } from '../../types/track.ts'
import {
  createSearchEngineForTests,
  type SearchEnginePorts,
} from './SearchEngine.ts'

function track(sourceId: string, n: number): Track {
  return {
    id: `${sourceId}:${n}`,
    sourceId,
    externalId: `ext-${sourceId}-${n}`,
    title: `Track ${n}`,
    artist: 'Artist',
  }
}

function pagingAdapter(
  id: string,
  pages: Track[][],
  options?: {
    failOnPage?: number
    failTimes?: number
    throwOnAvailable?: boolean
    available?: boolean
    onSearch?: (cursor: string | null) => void
  },
): MusicSourceAdapter {
  let failLeft = options?.failTimes ?? 0
  return {
    id,
    label: id,
    type: 'api',
    kind: 'official-api',
    capabilities: ['search'],
    supportsSearch: true,
    supportsStreaming: false,
    supportsPagination: true,
    initialize() {},
    isAvailable() {
      if (options?.throwOnAvailable) {
        throw new Error('available boom')
      }
      return options?.available ?? true
    },
    async fetchTracks() {
      return { tracks: [], nextCursor: null }
    },
    async search(_query, params) {
      const cursor = params?.cursor ?? null
      options?.onSearch?.(cursor)
      const offset = cursor ? Number.parseInt(String(cursor).split(':')[0] ?? '0', 10) || 0 : 0
      const pageIndex = Math.floor(offset / 20)
      if (options?.failOnPage === pageIndex && failLeft > 0) {
        failLeft -= 1
        throw new Error(`fail page ${pageIndex}`)
      }
      const page = pages[pageIndex] ?? []
      const hasMore = pageIndex + 1 < pages.length
      return {
        tracks: page,
        nextCursor: hasMore ? String(offset + 20) : null,
      }
    },
    async getTrack() {
      return null
    },
    async getStream() {
      throw new Error('no')
    },
    async getCover() {
      return undefined
    },
    dispose() {},
  } as MusicSourceAdapter
}

function portsFor(
  adapters: Record<string, MusicSourceAdapter>,
): SearchEnginePorts {
  return {
    bootstrap: () => {},
    isDemoSourceId: () => false,
    listEnabledSources: () =>
      Object.keys(adapters).map((id, index) => ({
        id,
        name: id,
        priority: index + 1,
      })),
    getAdapter: (id) => {
      const adapter = adapters[id]
      if (!adapter) {
        throw new Error(`missing adapter ${id}`)
      }
      return adapter
    },
    getCapabilities: () => ({
      search: true,
      library: false,
      streaming: false,
      download: false,
      artwork: false,
      authentication: false,
      lyrics: false,
      previewPlayback: false,
    }),
    getSearchProvider: () => null,
  }
}

test('independent cursors: 20→40→100+ across pages', async () => {
  const pages = [
    Array.from({ length: 20 }, (_, i) => track('a', i)),
    Array.from({ length: 20 }, (_, i) => track('a', i + 20)),
    Array.from({ length: 20 }, (_, i) => track('a', i + 40)),
    Array.from({ length: 20 }, (_, i) => track('a', i + 60)),
    Array.from({ length: 20 }, (_, i) => track('a', i + 80)),
  ]
  const engine = createSearchEngineForTests(
    portsFor({ a: pagingAdapter('a', pages) }),
  )
  assert.equal((await engine.search('q')).length, 20)
  assert.equal(engine.getState().hasMore, true)
  assert.equal((await engine.searchNext()).length, 40)
  assert.equal((await engine.searchNext()).length, 60)
  assert.equal((await engine.searchNext()).length, 80)
  assert.equal((await engine.searchNext()).length, 100)
  assert.equal(engine.getState().hasMore, false)
})

test('two sources keep independent cursors', async () => {
  const engine = createSearchEngineForTests(
    portsFor({
      a: pagingAdapter('a', [
        Array.from({ length: 20 }, (_, i) => track('a', i)),
        Array.from({ length: 5 }, (_, i) => track('a', i + 20)),
      ]),
      b: pagingAdapter('b', [
        Array.from({ length: 20 }, (_, i) => track('b', i)),
      ]),
    }),
  )
  const first = await engine.search('q')
  assert.equal(first.length, 40)
  const second = await engine.searchNext()
  assert.equal(second.length, 45)
  assert.equal(engine.getState().hasMore, false)
})

test('isAvailable throw is isolated; other source still returns', async () => {
  const engine = createSearchEngineForTests(
    portsFor({
      bad: pagingAdapter('bad', [Array.from({ length: 20 }, (_, i) => track('bad', i))], {
        throwOnAvailable: true,
      }),
      good: pagingAdapter('good', [
        Array.from({ length: 20 }, (_, i) => track('good', i)),
      ]),
    }),
  )
  const results = await engine.search('q')
  assert.equal(results.length, 20)
  assert.equal(results[0]?.sourceId, 'good')
  assert.equal(engine.getState().error, null)
  assert.ok(engine.getState().providerWarnings.length > 0)
  assert.match(engine.getState().providerWarnings[0] ?? '', /bad/)
})

test('transient page error keeps cursor then recovers on retry', async () => {
  const engine = createSearchEngineForTests(
    portsFor({
      a: pagingAdapter(
        'a',
        [
          Array.from({ length: 20 }, (_, i) => track('a', i)),
          Array.from({ length: 20 }, (_, i) => track('a', i + 20)),
        ],
        { failOnPage: 1, failTimes: 1 },
      ),
    }),
  )
  await engine.search('q')
  const afterFail = await engine.searchNext()
  assert.equal(afterFail.length, 20)
  assert.equal(engine.getState().hasMore, true)
  const afterRetry = await engine.searchNext()
  assert.equal(afterRetry.length, 40)
  assert.equal(engine.getState().hasMore, false)
})

test('duplicate page with advancing cursor does not stop on first hit', async () => {
  let calls = 0
  const first = Array.from({ length: 20 }, (_, i) => track('a', i))
  const adapter = pagingAdapter('a', [
    first,
    first, // duplicate, cursor advances → streak 1
    first, // duplicate again → streak 2 → stop
    Array.from({ length: 20 }, (_, i) => track('a', i + 40)),
  ])
  const original = adapter.search.bind(adapter)
  adapter.search = async (query, params) => {
    calls += 1
    return original(query, params)
  }
  const engine = createSearchEngineForTests(portsFor({ a: adapter }))
  await engine.search('q')
  await engine.searchNext()
  assert.equal(engine.getState().hasMore, true)
  assert.equal(engine.getState().results.length, 20)
  await engine.searchNext()
  assert.equal(engine.getState().results.length, 20)
  assert.equal(engine.getState().hasMore, false)
  assert.ok(calls >= 3)
})

test('new search cancels in-flight searchNext generation', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const adapter = pagingAdapter(
    'a',
    [
      Array.from({ length: 20 }, (_, i) => track('a', i)),
      Array.from({ length: 20 }, (_, i) => track('a', i + 20)),
    ],
    {
      onSearch: (cursor) => {
        if (cursor) {
          // block next page
        }
      },
    },
  )
  const original = adapter.search.bind(adapter)
  adapter.search = async (query, params) => {
    if (params?.cursor) {
      await gate
    }
    return original(query, params)
  }
  const engine = createSearchEngineForTests(portsFor({ a: adapter }))
  await engine.search('first')
  const pendingNext = engine.searchNext()
  const second = engine.search('second')
  release()
  await pendingNext
  const results = await second
  assert.equal(results.length, 20)
  assert.equal(engine.getState().query, 'second')
  assert.equal(engine.getState().loadingMore, false)
})

test('cache restores partial results and hasMore', async () => {
  const engine = createSearchEngineForTests(
    portsFor({
      a: pagingAdapter('a', [
        Array.from({ length: 20 }, (_, i) => track('a', i)),
        Array.from({ length: 20 }, (_, i) => track('a', i + 20)),
      ]),
    }),
  )
  await engine.search('cached')
  await engine.searchNext()
  assert.equal(engine.getState().results.length, 40)
  assert.equal(engine.getState().hasMore, false)

  // New engine instance sharing... same instance cache:
  const again = await engine.search('cached')
  assert.equal(again.length, 40)
  assert.equal(engine.getState().hasMore, false)
})
