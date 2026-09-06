import type { SearchEngineState } from '../../types/search'
import type { Track } from '../../types/track'
import { bootstrapMusicSources, sourceManager } from '../../sources'
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
 * Не знает конкретные Spotify/Yandex — только SourceManager + MusicSourceAdapter.
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

    const enabled = sourceManager.listEnabledSources()
    const activeSourceIds = enabled.map((source) => source.id)

    this.patchState({
      query: normalized,
      status: 'loading',
      error: null,
      activeSourceIds,
      hasMore: false,
    })

    const cacheKey = this.buildCacheKey(normalized, activeSourceIds)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.sourceCursors.clear()
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

      await Promise.all(
        enabled.map(async (config, sourceOrder) => {
          if (controller.signal.aborted) {
            return
          }

          const adapter = sourceManager.getAdapter(config.id)
          const available = await adapter.isAvailable()
          if (!available) {
            this.sourceCursors.set(config.id, null)
            return
          }

          const result = await adapter.search(normalized, {
            signal: controller.signal,
          })

          if (controller.signal.aborted) {
            return
          }

          this.sourceCursors.set(config.id, result.nextCursor ?? null)

          result.tracks.forEach((track, resultIndex) => {
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
      this.cache.set(cacheKey, merged)

      const hasMore = [...this.sourceCursors.values()].some(
        (cursor) => Boolean(cursor),
      )

      this.patchState({
        status: 'success',
        results: merged,
        error: null,
        lastSearchTime: Date.now(),
        cacheKey,
        hasMore,
      })

      return merged
    } catch (error) {
      if (controller.signal.aborted) {
        return this.state.results
      }

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
