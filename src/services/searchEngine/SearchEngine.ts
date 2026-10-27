import type { SearchEngineState } from '../../types/search'
import type { Track } from '../../types/track'
import { bootstrapMusicSources, sourceManager } from '../../sources'
import { isDemoSourceId } from '../../sources/demoSource'
import { pluginRegistry } from '../../sdk'
import { getMediaIndex, syncAdapterToMediaIndex } from '../mediaIndex'
import {
  beginDevSearchSession,
  pushDevSearchLog,
} from './devSearchLog'
import {
  mergeAndDedupeSearchResults,
  type RankedTrack,
} from './mergeResults'

type StateListener = (state: SearchEngineState) => void

const initialState: SearchEngineState = {
  query: '',
  status: 'idle',
  results: [],
  error: null,
  activeSourceIds: [],
  lastSearchTime: null,
  hasMore: false,
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
 */
export class SearchEngine {
  private state: SearchEngineState = { ...initialState }
  private readonly listeners = new Set<StateListener>()
  private abortController: AbortController | null = null
  /** Заготовка кэша query → Track[]. */
  private readonly cache = new Map<string, Track[]>()
  /** Заготовка курсоров для searchNext(). */
  private readonly sourceCursors = new Map<string, string | null>()

  getState(): SearchEngineState {
    return this.state
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
    const controller = new AbortController()
    this.abortController = controller

    const enabled = sourceManager.listEnabledSources().filter(
      (source) => !isDemoSourceId(source.id),
    )
    const activeSourceIds = enabled.map((source) => source.id)

    beginDevSearchSession(normalized)

    this.patchState({
      query: normalized,
      status: 'loading',
      error: null,
      activeSourceIds,
      hasMore: false,
    })

    // Dev: показать search-capable источники, которые выключены и не участвуют.
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
      pushDevSearchLog({
        stage: 'merged',
        message: `Results merged (cache)`,
        detail: `tracks=${cached.length}`,
      })
      pushDevSearchLog({
        stage: 'ui',
        message: 'UI rendered',
        detail: `results=${cached.length}`,
      })
      this.patchState({
        status: 'success',
        results: cached,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore: false,
      })
      return cached
    }

    try {
      const ranked: RankedTrack[] = []
      const providerErrors: string[] = []

      await Promise.all(
        enabled.map(async (config, sourceOrder) => {
          if (controller.signal.aborted) {
            return
          }

          const adapter = sourceManager.getAdapter(config.id)
          const providerLabel = config.name || config.id

          pushDevSearchLog({
            stage: 'provider',
            message: `Provider: ${providerLabel}`,
            providerId: config.id,
          })

          const available = await adapter.isAvailable()
          if (!available) {
            this.sourceCursors.set(config.id, null)
            pushDevSearchLog({
              stage: 'skip',
              message: `Skipped: provider unavailable`,
              providerId: config.id,
              detail: 'isAvailable() === false',
            })
            return
          }

          const caps = pluginRegistry.getCapabilities(config.id)
          const searchProvider = pluginRegistry.getSearchProvider(config.id)
          const useLiveSearch =
            Boolean(searchProvider) || caps?.search === true
          const useIndex = !useLiveSearch && caps?.library === true

          let tracks: Track[] = []
          let nextCursor: string | null = null

          try {
            if (useLiveSearch) {
              pushDevSearchLog({
                stage: 'request',
                message: searchProvider
                  ? 'SearchProvider.search()'
                  : 'MusicSourceAdapter.search()',
                providerId: config.id,
              })

              // SearchProvider и adapter.search используют один live API;
              // adapter даёт SearchResult + cursor.
              const result = await adapter.search(normalized, {
                signal: controller.signal,
              })
              tracks = result.tracks
              nextCursor = result.nextCursor ?? null

              pushDevSearchLog({
                stage: 'tracks',
                message: `Tracks received: ${tracks.length}`,
                providerId: config.id,
              })
              pushDevSearchLog({
                stage: 'mapped',
                message: `Mapped Track: ${tracks.length}`,
                providerId: config.id,
              })
            } else if (useIndex) {
              pushDevSearchLog({
                stage: 'request',
                message: 'MediaIndex.search()',
                providerId: config.id,
              })
              const index = getMediaIndex()
              await index.whenReady()
              let records = index.search(normalized, [config.id])
              if (
                records.length === 0 &&
                index.bySource(config.id).length === 0
              ) {
                await syncAdapterToMediaIndex(adapter, {
                  signal: controller.signal,
                })
                records = index.search(normalized, [config.id])
              }
              tracks = records.map((record) => record.track)
              nextCursor = null
              pushDevSearchLog({
                stage: 'tracks',
                message: `Tracks received: ${tracks.length}`,
                providerId: config.id,
                detail: 'via MediaIndex',
              })
              pushDevSearchLog({
                stage: 'mapped',
                message: `Mapped Track: ${tracks.length}`,
                providerId: config.id,
              })
            } else {
              pushDevSearchLog({
                stage: 'request',
                message: 'MusicSourceAdapter.search() (fallback)',
                providerId: config.id,
              })
              const result = await adapter.search(normalized, {
                signal: controller.signal,
              })
              tracks = result.tracks
              nextCursor = result.nextCursor ?? null
              pushDevSearchLog({
                stage: 'tracks',
                message: `Tracks received: ${tracks.length}`,
                providerId: config.id,
              })
              pushDevSearchLog({
                stage: 'mapped',
                message: `Mapped Track: ${tracks.length}`,
                providerId: config.id,
              })
            }
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
            this.sourceCursors.set(config.id, null)
            return
          }

          if (controller.signal.aborted) {
            return
          }

          this.sourceCursors.set(config.id, nextCursor)

          tracks.forEach((track, resultIndex) => {
            ranked.push({
              track,
              sourcePriority: config.priority,
              sourceOrder,
              resultIndex,
            })
          })
        }),
      )

      if (controller.signal.aborted) {
        return this.state.results
      }

      const merged = mergeAndDedupeSearchResults(ranked)
      if (merged.length > 0) {
        this.cache.set(cacheKey, merged)
      }

      const hasMore = [...this.sourceCursors.values()].some((cursor) =>
        Boolean(cursor),
      )

      pushDevSearchLog({
        stage: 'merged',
        message: 'Results merged',
        detail: `tracks=${merged.length}`,
      })
      pushDevSearchLog({
        stage: 'ui',
        message: 'UI rendered',
        detail: `results=${merged.length}`,
      })

      const surfaceError =
        merged.length === 0 && providerErrors.length > 0
          ? providerErrors[0]
          : null

      this.patchState({
        status: surfaceError ? 'error' : 'success',
        results: merged,
        error: surfaceError,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore,
      })

      return merged
    } catch (error) {
      if (controller.signal.aborted) {
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
      })
      throw error
    } finally {
      if (this.abortController === controller) {
        this.abortController = null
      }
    }
  }

  /**
   * Заготовка постраничной / ленивой подгрузки.
   * Пока возвращает текущие results без сетевых запросов.
   */
  async searchNext(): Promise<Track[]> {
    if (!this.state.query || !this.state.hasMore) {
      return this.state.results
    }

    // Архитектура готова: cursors в sourceCursors, реализация — позже.
    return this.state.results
  }

  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
    if (this.state.status === 'loading') {
      this.patchState({ status: this.state.results.length ? 'success' : 'idle' })
    }
  }

  clear(): void {
    this.cancel()
    this.sourceCursors.clear()
    this.patchState({ ...initialState })
  }

  /** Сброс кэша (для будущих настроек / смены источников). */
  clearCache(): void {
    this.cache.clear()
  }

  private buildCacheKey(query: string, sourceIds: string[]): string {
    return `${query.toLowerCase()}::${sourceIds.join(',')}`
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
