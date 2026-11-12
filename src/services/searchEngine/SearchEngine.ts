import type { SearchEngineState } from '../../types/search'
import type { Track } from '../../types/track'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter.ts'
import type { ProviderCapabilities, SearchProvider } from '../../sdk/types.ts'
import {
  beginDevSearchSession,
  pushDevSearchLog,
} from './devSearchLog.ts'
import {
  mergeAndDedupeSearchResults,
  trackDedupeKey,
  type RankedTrack,
} from './mergeResults.ts'
import { mergeProviderWarnings } from './searchPlayability.ts'

type StateListener = (state: SearchEngineState) => void

const PAGE_LIMIT = 20
/** Временные ошибки провайдера: столько раз оставляем cursor для retry. */
const MAX_PROVIDER_RETRIES = 2
/** Подряд идущие страницы без новых unique при продвинутом cursor → стоп. */
const MAX_DUPLICATE_STREAK = 2

export type SearchSourceConfig = {
  id: string
  name: string
  priority: number
}

export type SearchEnginePorts = {
  bootstrap: () => void
  listEnabledSources: () => SearchSourceConfig[]
  getAdapter: (id: string) => MusicSourceAdapter
  getCapabilities: (id: string) => ProviderCapabilities | null
  getSearchProvider: (id: string) => SearchProvider | null
  isDemoSourceId: (id: string) => boolean
}

type SearchCacheEntry = {
  results: Track[]
  sourceCursors: Record<string, string | null>
  hasMore: boolean
  activeSourceIds: string[]
  providerWarnings?: string[]
  providerRetries?: Record<string, number>
  duplicateStreaks?: Record<string, number>
}

const initialState: SearchEngineState = {
  query: '',
  status: 'idle',
  results: [],
  error: null,
  providerWarnings: [],
  activeSourceIds: [],
  lastSearchTime: null,
  hasMore: false,
  loadingMore: false,
  cacheKey: null,
}

/**
 * Универсальный поисковый движок.
 * Пагинация: независимые cursors; searchNext() догружает страницы.
 * Ports обязательны — production wiring в getSearchEngine() / searchEnginePorts.
 */
export class SearchEngine {
  private state: SearchEngineState = { ...initialState }
  private readonly listeners = new Set<StateListener>()
  private abortController: AbortController | null = null
  private readonly cache = new Map<string, SearchCacheEntry>()
  private readonly sourceCursors = new Map<string, string | null>()
  private readonly providerRetries = new Map<string, number>()
  private readonly duplicateStreaks = new Map<string, number>()
  private nextInFlight = false
  /** Инвалидирует in-flight searchNext при cancel/новом search. */
  private nextFlightGeneration = 0
  private searchGeneration = 0
  private readonly ports: SearchEnginePorts

  constructor(ports: SearchEnginePorts) {
    this.ports = ports
  }

  getState(): SearchEngineState {
    return this.state
  }

  replaceResultsForHarness(query: string, tracks: readonly Track[]): void {
    this.invalidateNextFlight()
    this.abortController?.abort()
    this.abortController = null
    this.sourceCursors.clear()
    this.providerRetries.clear()
    this.duplicateStreaks.clear()
    this.patchState({
      query,
      status: 'success',
      results: [...tracks],
      error: null,
      providerWarnings: [],
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
    this.ports.bootstrap()

    const normalized = query.trim()
    if (!normalized) {
      this.clear()
      return []
    }

    this.cancel()
    const generation = ++this.searchGeneration
    const controller = new AbortController()
    this.abortController = controller

    const enabled = this.ports
      .listEnabledSources()
      .filter((source) => !this.ports.isDemoSourceId(source.id))
    const activeSourceIds = enabled.map((source) => source.id)

    beginDevSearchSession(normalized)

    this.patchState({
      query: normalized,
      status: 'loading',
      error: null,
      providerWarnings: [],
      activeSourceIds,
      hasMore: false,
      loadingMore: false,
    })

    const cacheKey = this.buildCacheKey(normalized, activeSourceIds)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.restoreCursorMaps(cached)
      pushDevSearchLog({
        stage: 'merged',
        message: `Results merged (cache)`,
        detail: `tracks=${cached.results.length};hasMore=${cached.hasMore}`,
      })
      this.patchState({
        status: 'success',
        results: cached.results,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore: cached.hasMore,
        loadingMore: false,
        error: null,
        providerWarnings: cached.providerWarnings ?? [],
      })
      return cached.results
    }

    this.sourceCursors.clear()
    this.providerRetries.clear()
    this.duplicateStreaks.clear()

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

      const hasMore = this.computeHasMore()
      const surfaceError =
        page.tracks.length === 0 && page.providerErrors.length > 0
          ? page.providerErrors[0]!
          : null
      const providerWarnings =
        page.tracks.length > 0 ? page.providerErrors : []

      this.writeCache(cacheKey, {
        results: page.tracks,
        sourceCursors: Object.fromEntries(this.sourceCursors),
        hasMore,
        activeSourceIds,
        providerWarnings,
        providerRetries: Object.fromEntries(this.providerRetries),
        duplicateStreaks: Object.fromEntries(this.duplicateStreaks),
      })

      pushDevSearchLog({
        stage: 'merged',
        message: 'Results merged',
        detail: `tracks=${page.tracks.length};hasMore=${hasMore};warnings=${providerWarnings.length}`,
      })

      this.patchState({
        status: surfaceError ? 'error' : 'success',
        results: page.tracks,
        error: surfaceError,
        providerWarnings,
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
        providerWarnings: [],
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

  async searchNext(): Promise<Track[]> {
    this.ports.bootstrap()

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

    const flightId = ++this.nextFlightGeneration
    this.nextInFlight = true
    const generation = this.searchGeneration
    const controller = new AbortController()
    this.abortController = controller

    this.patchState({ loadingMore: true, error: null })

    const enabled = this.ports
      .listEnabledSources()
      .filter((source) => !this.ports.isDemoSourceId(source.id))
    const enabledById = new Map(enabled.map((s) => [s.id, s]))
    const sourcesForPage = pending
      .map(([id]) => enabledById.get(id))
      .filter((s): s is SearchSourceConfig => Boolean(s))

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

      if (
        controller.signal.aborted ||
        generation !== this.searchGeneration ||
        flightId !== this.nextFlightGeneration
      ) {
        return this.state.results
      }

      for (const [id, cursor] of page.cursors) {
        this.sourceCursors.set(id, cursor)
      }
      for (const [id] of pending) {
        if (!enabledById.has(id)) {
          this.sourceCursors.set(id, null)
        }
      }

      const priorKeys = new Set(
        this.state.results.map((track) => trackDedupeKey(track)),
      )
      const appended = mergeAndDedupeSearchResults(page.ranked).filter(
        (track) => !priorKeys.has(trackDedupeKey(track)),
      )
      const merged = [...this.state.results, ...appended]

      const hasMore = this.computeHasMore()
      const providerWarnings = mergeProviderWarnings(
        this.state.providerWarnings,
        page.providerErrors,
      )
      const cacheKey =
        this.state.cacheKey ??
        this.buildCacheKey(this.state.query, this.state.activeSourceIds)
      this.writeCache(cacheKey, {
        results: merged,
        sourceCursors: Object.fromEntries(this.sourceCursors),
        hasMore,
        activeSourceIds: this.state.activeSourceIds,
        providerWarnings,
        providerRetries: Object.fromEntries(this.providerRetries),
        duplicateStreaks: Object.fromEntries(this.duplicateStreaks),
      })

      pushDevSearchLog({
        stage: 'merged',
        message: 'Results merged (next page)',
        detail: `tracks=${merged.length};added=${appended.length};hasMore=${hasMore};warnings=${providerWarnings.length}`,
      })

      this.patchState({
        status: 'success',
        results: merged,
        hasMore,
        loadingMore: false,
        lastSearchTime: Date.now(),
        cacheKey,
        error: null,
        providerWarnings,
      })

      return merged
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== this.searchGeneration ||
        flightId !== this.nextFlightGeneration
      ) {
        return this.state.results
      }
      pushDevSearchLog({
        stage: 'error',
        message: 'searchNext failed',
        detail: error instanceof Error ? error.message : String(error),
      })
      this.patchState({
        loadingMore: false,
      })
      return this.state.results
    } finally {
      if (flightId === this.nextFlightGeneration) {
        this.nextInFlight = false
      }
      if (this.abortController === controller) {
        this.abortController = null
      }
    }
  }

  cancel(): void {
    this.invalidateNextFlight()
    this.abortController?.abort()
    this.abortController = null
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
    this.providerRetries.clear()
    this.duplicateStreaks.clear()
    this.patchState({ ...initialState })
  }

  clearCache(): void {
    this.cache.clear()
  }

  private invalidateNextFlight(): void {
    this.nextFlightGeneration += 1
    this.nextInFlight = false
  }

  private computeHasMore(): boolean {
    return [...this.sourceCursors.values()].some(
      (cursor) => cursor != null && cursor !== '',
    )
  }

  private restoreCursorMaps(cached: SearchCacheEntry): void {
    this.sourceCursors.clear()
    for (const [id, cursor] of Object.entries(cached.sourceCursors)) {
      this.sourceCursors.set(id, cursor)
    }
    this.providerRetries.clear()
    for (const [id, count] of Object.entries(cached.providerRetries ?? {})) {
      this.providerRetries.set(id, count)
    }
    this.duplicateStreaks.clear()
    for (const [id, count] of Object.entries(cached.duplicateStreaks ?? {})) {
      this.duplicateStreaks.set(id, count)
    }
  }

  private writeCache(cacheKey: string, entry: SearchCacheEntry): void {
    this.cache.set(cacheKey, entry)
  }

  private buildCacheKey(query: string, sourceIds: string[]): string {
    return `${query.toLowerCase()}::${sourceIds.join(',')}`
  }

  private async fetchPageFromSources(input: {
    query: string
    enabled: SearchSourceConfig[]
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

        const providerLabel = config.name || config.id
        const cursor = input.cursors.get(config.id) ?? null

        pushDevSearchLog({
          stage: 'provider',
          message: `Provider: ${providerLabel}`,
          providerId: config.id,
          detail: cursor ? `cursor=${cursor}` : 'first page',
        })

        try {
          const adapter = this.ports.getAdapter(config.id)
          let available = false
          try {
            available = Boolean(await adapter.isAvailable())
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : String(error)
            pushDevSearchLog({
              stage: 'error',
              message: `isAvailable() failed`,
              providerId: config.id,
              detail,
            })
            this.applyTransientProviderFailure(
              config.id,
              cursor,
              nextCursors,
              providerErrors,
              providerLabel,
              detail,
            )
            return
          }

          if (!available) {
            nextCursors.set(config.id, null)
            this.providerRetries.delete(config.id)
            pushDevSearchLog({
              stage: 'skip',
              message: `Skipped: provider unavailable`,
              providerId: config.id,
              detail: 'isAvailable() === false',
            })
            return
          }

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

          // Успех — сбрасываем retry-счётчик.
          this.providerRetries.delete(config.id)

          let nextCursor = page.nextCursor ?? null
          if (page.tracks.length === 0) {
            nextCursor = null
            this.duplicateStreaks.delete(config.id)
          } else {
            const uniqueNew = page.tracks.filter(
              (track) => !input.existingKeys.has(trackDedupeKey(track)),
            )
            if (cursor != null && uniqueNew.length === 0) {
              nextCursor = this.resolveDuplicatePageCursor({
                sourceId: config.id,
                requestCursor: cursor,
                responseCursor: nextCursor,
              })
            } else {
              this.duplicateStreaks.delete(config.id)
            }
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
          if (input.signal.aborted) {
            return
          }
          const detail =
            error instanceof Error ? error.message : String(error)
          pushDevSearchLog({
            stage: 'error',
            message: `Provider search failed`,
            providerId: config.id,
            detail,
          })
          this.applyTransientProviderFailure(
            config.id,
            cursor,
            nextCursors,
            providerErrors,
            providerLabel,
            detail,
          )
        }
      }),
    )

    const tracks = mergeAndDedupeSearchResults(ranked)
    return { tracks, ranked, cursors: nextCursors, providerErrors }
  }

  /**
   * Дубликат-страница: если cursor продвинулся — даём ещё попытки (streak),
   * иначе останавливаем источник (защита от бесконечного цикла).
   */
  private resolveDuplicatePageCursor(input: {
    sourceId: string
    requestCursor: string
    responseCursor: string | null
  }): string | null {
    const advanced =
      input.responseCursor != null &&
      input.responseCursor !== '' &&
      input.responseCursor !== input.requestCursor

    if (!advanced) {
      this.duplicateStreaks.delete(input.sourceId)
      pushDevSearchLog({
        stage: 'skip',
        message: 'Stopped: duplicate page without cursor advance',
        providerId: input.sourceId,
      })
      return null
    }

    const streak = (this.duplicateStreaks.get(input.sourceId) ?? 0) + 1
    this.duplicateStreaks.set(input.sourceId, streak)
    if (streak >= MAX_DUPLICATE_STREAK) {
      pushDevSearchLog({
        stage: 'skip',
        message: 'Stopped: duplicate pages streak',
        providerId: input.sourceId,
        detail: `streak=${streak}`,
      })
      this.duplicateStreaks.delete(input.sourceId)
      return null
    }

    pushDevSearchLog({
      stage: 'skip',
      message: 'Duplicate page; cursor advanced — retry later',
      providerId: input.sourceId,
      detail: `streak=${streak}`,
    })
    return input.responseCursor
  }

  /** Временная ошибка: сохраняем cursor до MAX_PROVIDER_RETRIES, затем закрываем. */
  private applyTransientProviderFailure(
    sourceId: string,
    cursor: string | null,
    nextCursors: Map<string, string | null>,
    providerErrors: string[],
    providerLabel: string,
    detail: string,
  ): void {
    providerErrors.push(`${providerLabel}: ${detail}`)
    const retries = (this.providerRetries.get(sourceId) ?? 0) + 1
    this.providerRetries.set(sourceId, retries)
    if (retries > MAX_PROVIDER_RETRIES || cursor == null) {
      nextCursors.set(sourceId, null)
      this.providerRetries.delete(sourceId)
      pushDevSearchLog({
        stage: 'skip',
        message: 'Provider exhausted after retries',
        providerId: sourceId,
        detail: `retries=${retries}`,
      })
      return
    }
    // Оставляем прежний cursor для безопасного retry.
    nextCursors.set(sourceId, cursor)
    pushDevSearchLog({
      stage: 'skip',
      message: 'Provider error; cursor kept for retry',
      providerId: sourceId,
      detail: `retries=${retries}/${MAX_PROVIDER_RETRIES}`,
    })
  }

  private async searchOneSource(input: {
    adapter: MusicSourceAdapter
    configId: string
    query: string
    cursor: string | null
    signal: AbortSignal
  }): Promise<{ tracks: Track[]; nextCursor: string | null }> {
    const caps = this.ports.getCapabilities(input.configId)
    const searchProvider = this.ports.getSearchProvider(input.configId)
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

    if (input.cursor) {
      return { tracks: [], nextCursor: null }
    }

    pushDevSearchLog({
      stage: 'request',
      message: 'MediaIndex.search()',
      providerId: input.configId,
    })
    const { getMediaIndex, syncAdapterToMediaIndex } = await import(
      '../mediaIndex/index.ts'
    )
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
let defaultPortsFactory: (() => SearchEnginePorts) | null = null

/** Регистрация production ports из index.ts (не из unit-тестов ядра). */
export function registerSearchEnginePortsFactory(
  factory: () => SearchEnginePorts,
): void {
  defaultPortsFactory = factory
}

export function getSearchEngine(): SearchEngine {
  if (!singleton) {
    if (!defaultPortsFactory) {
      throw new Error(
        'SearchEngine ports are not registered. Import from services/searchEngine index.',
      )
    }
    singleton = new SearchEngine(defaultPortsFactory())
  }
  return singleton
}

export function resetSearchEngineForTests(): void {
  singleton = null
}

/** Создать изолированный движок с mock ports (unit-тесты). */
export function createSearchEngineForTests(ports: SearchEnginePorts): SearchEngine {
  return new SearchEngine(ports)
}
