import type { SearchEngineState } from '../../types/search'
import type { Track } from '../../types/track'
import { bootstrapMusicSources, sourceManager } from '../../sources'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter'
import { isDemoSourceId } from '../../sources/demoSource'
import { pluginRegistry } from '../../sdk'
import { getMediaIndex, syncAdapterToMediaIndex } from '../mediaIndex'
import {
  beginDevSearchSession,
  pushDevSearchLog,
} from './devSearchLog'
import {
  mergeAndDedupeSearchResults,
  trackDedupeKey,
  type RankedTrack,
} from './mergeResults'

type StateListener = (state: SearchEngineState) => void

const PAGE_LIMIT = 20

type SearchCacheEntry = {
  results: Track[]
  /** Курсор следующего запроса по sourceId; null = источник исчерпан. */
  sourceCursors: Record<string, string | null>
  hasMore: boolean
  activeSourceIds: string[]
}

const initialState: SearchEngineState = {
  query: '',
  status: 'idle',
  results: [],
  error: null,
  activeSourceIds: [],
  lastSearchTime: null,
  hasMore: false,
  loadingMore: false,
  cacheKey: null,
}

/**
 * Универсальный поисковый движок.
 * Не знает конкретные Spotify/Yandex — только SourceManager + PluginRegistry + adapters.
 *
 * Стратегия на источник:
 * 1. SearchProvider (SDK) или capabilities.search → live adapter.search()
 * 2. иначе capabilities.library → MediaIndex
 * 3. иначе → adapter.search()
 *
 * Пагинация: независимые cursors на sourceId; searchNext() догружает страницы.
 */
export class SearchEngine {
  private state: SearchEngineState = { ...initialState }
  private readonly listeners = new Set<StateListener>()
  private abortController: AbortController | null = null
  /** Кэш query+sources → частичная или полная выдача + cursors. */
  private readonly cache = new Map<string, SearchCacheEntry>()
  private readonly sourceCursors = new Map<string, string | null>()
  /** Защита от пересекающихся searchNext(). */
  private nextInFlight = false
  private searchGeneration = 0

  getState(): SearchEngineState {
    return this.state
  }

  /**
   * Только SEARCH-FLOW harness: подставить контролируемую выдачу в UI поиска.
   * Обычный search() этим путём не ходит.
   */
  replaceResultsForHarness(query: string, tracks: readonly Track[]): void {
    this.abortController?.abort()
    this.abortController = null
    this.nextInFlight = false
    this.sourceCursors.clear()
    this.patchState({
      query,
      status: 'success',
      results: [...tracks],
      error: null,
      activeSourceIds: ['harness'],
      lastSearchTime: Date.now(),
      hasMore: false,
      loadingMore: false,
      cacheKey: `harness:${query}`,
    })
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async search(query: string): Promise<Track[]> {
    bootstrapMusicSources()

    const normalized = query.trim()
    if (!normalized) {
      this.clear()
      return []
    }

    this.cancel()
    const generation = ++this.searchGeneration
    const controller = new AbortController()
    this.abortController = controller
    this.nextInFlight = false

    const enabled = sourceManager
      .listEnabledSources()
      .filter((source) => !isDemoSourceId(source.id))
    const activeSourceIds = enabled.map((source) => source.id)

    beginDevSearchSession(normalized)

    this.patchState({
      query: normalized,
      status: 'loading',
      error: null,
      activeSourceIds,
      hasMore: false,
      loadingMore: false,
    })

    if (import.meta.env.DEV) {
      const enabledIds = new Set(activeSourceIds)
      for (const config of sourceManager.listSources()) {
        if (enabledIds.has(config.id) || isDemoSourceId(config.id)) {
          continue
        }
        const caps = pluginRegistry.getCapabilities(config.id)
        const hasSearch =
          Boolean(pluginRegistry.getSearchProvider(config.id)) ||
          caps?.search === true
        if (!hasSearch) {
          continue
        }
        pushDevSearchLog({
          stage: 'skip',
          message: `Skipped: source disabled`,
          providerId: config.id,
          detail: 'Включите на /sources (после OAuth источник должен включаться сам)',
        })
      }
    }

    const cacheKey = this.buildCacheKey(normalized, activeSourceIds)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.sourceCursors.clear()
      for (const [id, cursor] of Object.entries(cached.sourceCursors)) {
        this.sourceCursors.set(id, cursor)
      }
      pushDevSearchLog({
        stage: 'merged',
        message: `Results merged (cache)`,
        detail: `tracks=${cached.results.length};hasMore=${cached.hasMore}`,
      })
      pushDevSearchLog({
        stage: 'ui',
        message: 'UI rendered',
        detail: `results=${cached.results.length}`,
      })
      this.patchState({
        status: 'success',
        results: cached.results,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore: cached.hasMore,
        loadingMore: false,
        error: null,
      })
      return cached.results
    }

    try {
      const page = await this.fetchPageFromSources({
        query: normalized,
        enabled,
        cursors: new Map(enabled.map((s) => [s.id, null as string | null])),
        signal: controller.signal,
        existingKeys: new Set(),
      })

      if (controller.signal.aborted || generation !== this.searchGeneration) {
        return this.state.results
      }

      this.sourceCursors.clear()
      for (const [id, cursor] of page.cursors) {
        this.sourceCursors.set(id, cursor)
      }

      const hasMore = [...this.sourceCursors.values()].some((cursor) =>
        Boolean(cursor),
      )
      this.writeCache(cacheKey, {
        results: page.tracks,
        sourceCursors: Object.fromEntries(this.sourceCursors),
        hasMore,
        activeSourceIds,
      })

      pushDevSearchLog({
        stage: 'merged',
        message: 'Results merged',
        detail: `tracks=${page.tracks.length};hasMore=${hasMore}`,
      })
      pushDevSearchLog({
        stage: 'ui',
        message: 'UI rendered',
        detail: `results=${page.tracks.length}`,
      })

      const surfaceError =
        page.tracks.length === 0 && page.providerErrors.length > 0
          ? page.providerErrors[0]!
          : null

      this.patchState({
        status: surfaceError ? 'error' : 'success',
        results: page.tracks,
        error: surfaceError,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore,
        loadingMore: false,
      })

      return page.tracks
    } catch (error) {
      if (controller.signal.aborted || generation !== this.searchGeneration) {
        return this.state.results
      }

      pushDevSearchLog({
        stage: 'error',
        message: 'SearchEngine failed',
        detail: error instanceof Error ? error.message : String(error),
      })

      this.patchState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Search failed',
        results: [],
        hasMore: false,
        loadingMore: false,
      })
      throw error
    } finally {
      if (this.abortController === controller) {
        this.abortController = null
      }
    }
  }

  /**
   * Следующая страница по всем источникам с живым cursor.
   * Не сбрасывает уже загруженные results; ошибки одного провайдера изолированы.
   */
  async searchNext(): Promise<Track[]> {
    bootstrapMusicSources()

    if (
      !this.state.query ||
      !this.state.hasMore ||
      this.nextInFlight ||
      this.state.status === 'loading' ||
      this.state.loadingMore
    ) {
      return this.state.results
    }

    const pending = [...this.sourceCursors.entries()].filter(
      ([, cursor]) => cursor != null && cursor !== '',
    )
    if (pending.length === 0) {
      this.patchState({ hasMore: false, loadingMore: false })
      return this.state.results
    }

    this.nextInFlight = true
    const generation = this.searchGeneration
    const controller = new AbortController()
    this.abortController?.abort()
    this.abortController = controller

    this.patchState({ loadingMore: true, error: null })

    const enabled = sourceManager
      .listEnabledSources()
      .filter((source) => !isDemoSourceId(source.id))
    const enabledById = new Map(enabled.map((s) => [s.id, s]))
    const sourcesForPage = pending
      .map(([id]) => enabledById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))

    const existingKeys = new Set(
      this.state.results.map((track) => trackDedupeKey(track)),
    )

    try {
      const page = await this.fetchPageFromSources({
        query: this.state.query,
        enabled: sourcesForPage,
        cursors: new Map(pending),
        signal: controller.signal,
        existingKeys,
      })

      if (controller.signal.aborted || generation !== this.searchGeneration) {
        return this.state.results
      }

      for (const [id, cursor] of page.cursors) {
        this.sourceCursors.set(id, cursor)
      }
      // Источники, которые больше не enabled — закрываем cursor.
      for (const [id] of pending) {
        if (!enabledById.has(id)) {
          this.sourceCursors.set(id, null)
        }
      }

      // Сохраняем порядок уже показанных треков; дописываем только новые unique.
      const priorKeys = new Set(
        this.state.results.map((track) => trackDedupeKey(track)),
      )
      const appended = mergeAndDedupeSearchResults(page.ranked).filter(
        (track) => !priorKeys.has(trackDedupeKey(track)),
      )
      const merged = [...this.state.results, ...appended]

      const hasMore = [...this.sourceCursors.values()].some((cursor) =>
        Boolean(cursor),
      )
      const cacheKey =
        this.state.cacheKey ??
        this.buildCacheKey(this.state.query, this.state.activeSourceIds)
      this.writeCache(cacheKey, {
        results: merged,
        sourceCursors: Object.fromEntries(this.sourceCursors),
        hasMore,
        activeSourceIds: this.state.activeSourceIds,
      })

      pushDevSearchLog({
        stage: 'merged',
        message: 'Results merged (next page)',
        detail: `tracks=${merged.length};added=${appended.length};hasMore=${hasMore}`,
      })

      this.patchState({
        status: 'success',
        results: merged,
        hasMore,
        loadingMore: false,
        lastSearchTime: Date.now(),
        cacheKey,
        // Не затираем успешную выдачу ошибкой догрузки.
        error: null,
      })

      return merged
    } catch (error) {
      if (controller.signal.aborted || generation !== this.searchGeneration) {
        return this.state.results
      }
      pushDevSearchLog({
        stage: 'error',
        message: 'searchNext failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      this.patchState({
        loadingMore: false,
        // Сохраняем текущие results; hasMore оставляем — можно повторить.
      })
      return this.state.results
    } finally {
      this.nextInFlight = false
      if (this.abortController === controller) {
        this.abortController = null
      }
    }
  }

  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
    this.nextInFlight = false
    if (this.state.status === 'loading' || this.state.loadingMore) {
      this.patchState({
        status: this.state.results.length ? 'success' : 'idle',
        loadingMore: false,
      })
    }
  }

  clear(): void {
    this.cancel()
    this.searchGeneration += 1
    this.sourceCursors.clear()
    this.patchState({ ...initialState })
  }

  /** Сброс кэша (для будущих настроек / смены источников). */
  clearCache(): void {
    this.cache.clear()
  }

  private writeCache(cacheKey: string, entry: SearchCacheEntry): void {
    this.cache.set(cacheKey, entry)
  }

  private buildCacheKey(query: string, sourceIds: string[]): string {
    return `${query.toLowerCase()}::${sourceIds.join(',')}`
  }

  private async fetchPageFromSources(input: {
    query: string
    enabled: ReturnType<typeof sourceManager.listEnabledSources>
    cursors: Map<string, string | null>
    signal: AbortSignal
    existingKeys: Set<string>
  }): Promise<{
    tracks: Track[]
    ranked: RankedTrack[]
    cursors: Map<string, string | null>
    providerErrors: string[]
  }> {
    const ranked: RankedTrack[] = []
    const providerErrors: string[] = []
    const nextCursors = new Map(input.cursors)

    await Promise.all(
      input.enabled.map(async (config, sourceOrder) => {
        if (input.signal.aborted) {
          return
        }

        const adapter = sourceManager.getAdapter(config.id)
        const providerLabel = config.name || config.id
        const cursor = input.cursors.get(config.id) ?? null

        pushDevSearchLog({
          stage: 'provider',
          message: `Provider: ${providerLabel}`,
          providerId: config.id,
          detail: cursor ? `cursor=${cursor}` : 'first page',
        })

        const available = await adapter.isAvailable()
        if (!available) {
          nextCursors.set(config.id, null)
          pushDevSearchLog({
            stage: 'skip',
            message: `Skipped: provider unavailable`,
            providerId: config.id,
            detail: 'isAvailable() === false',
          })
          return
        }

        try {
          const page = await this.searchOneSource({
            adapter,
            configId: config.id,
            query: input.query,
            cursor,
            signal: input.signal,
          })

          if (input.signal.aborted) {
            return
          }

          let nextCursor = page.nextCursor ?? null
          if (page.tracks.length === 0) {
            nextCursor = null
          }

          // Защита от пустых/дублирующих страниц: нет новых уникальных — стоп.
          const uniqueNew = page.tracks.filter(
            (track) => !input.existingKeys.has(trackDedupeKey(track)),
          )
          if (
            cursor != null &&
            page.tracks.length > 0 &&
            uniqueNew.length === 0
          ) {
            nextCursor = null
            pushDevSearchLog({
              stage: 'skip',
              message: 'Stopped: page had no new unique tracks',
              providerId: config.id,
            })
          }

          nextCursors.set(config.id, nextCursor)

          page.tracks.forEach((track, resultIndex) => {
            ranked.push({
              track,
              sourcePriority: config.priority,
              sourceOrder,
              resultIndex,
            })
          })
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error)
          pushDevSearchLog({
            stage: 'error',
            message: `Provider search failed`,
            providerId: config.id,
            detail,
          })
          providerErrors.push(`${providerLabel}: ${detail}`)
          // Ошибка страницы: не крутим тот же cursor бесконечно.
          nextCursors.set(config.id, null)
        }
      }),
    )

    const tracks = mergeAndDedupeSearchResults(ranked)
    return { tracks, ranked, cursors: nextCursors, providerErrors }
  }

  private async searchOneSource(input: {
    adapter: MusicSourceAdapter
    configId: string
    query: string
    cursor: string | null
    signal: AbortSignal
  }): Promise<{ tracks: Track[]; nextCursor: string | null }> {
    const caps = pluginRegistry.getCapabilities(input.configId)
    const searchProvider = pluginRegistry.getSearchProvider(input.configId)
    const useLiveSearch =
      Boolean(searchProvider) || caps?.search === true
    const useIndex = !useLiveSearch && caps?.library === true

    if (useLiveSearch || !useIndex) {
      pushDevSearchLog({
        stage: 'request',
        message: searchProvider
          ? 'SearchProvider / adapter.search()'
          : 'MusicSourceAdapter.search()',
        providerId: input.configId,
      })
      const result = await input.adapter.search(input.query, {
        limit: PAGE_LIMIT,
        cursor: input.cursor,
        signal: input.signal,
      })
      pushDevSearchLog({
        stage: 'tracks',
        message: `Tracks received: ${result.tracks.length}`,
        providerId: input.configId,
      })
      return {
        tracks: result.tracks,
        nextCursor: result.nextCursor ?? null,
      }
    }

    // MediaIndex: пагинации нет — одна «страница», дальше cursor=null.
    if (input.cursor) {
      return { tracks: [], nextCursor: null }
    }

    pushDevSearchLog({
      stage: 'request',
      message: 'MediaIndex.search()',
      providerId: input.configId,
    })
    const index = getMediaIndex()
    await index.whenReady()
    let records = index.search(input.query, [input.configId])
    if (records.length === 0 && index.bySource(input.configId).length === 0) {
      await syncAdapterToMediaIndex(input.adapter, {
        signal: input.signal,
      })
      records = index.search(input.query, [input.configId])
    }
    const tracks = records.map((record) => record.track)
    pushDevSearchLog({
      stage: 'tracks',
      message: `Tracks received: ${tracks.length}`,
      providerId: input.configId,
      detail: 'via MediaIndex',
    })
    return { tracks, nextCursor: null }
  }

  private patchState(partial: Partial<SearchEngineState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

let singleton: SearchEngine | null = null

export function getSearchEngine(): SearchEngine {
  if (!singleton) {
    singleton = new SearchEngine()
  }
  return singleton
}

/** Сброс singleton для unit-тестов. */
export function resetSearchEngineForTests(): void {
  singleton = null
}
