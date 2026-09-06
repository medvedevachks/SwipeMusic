import type { ProviderContext, SearchProvider } from '../../src/sdk'
import { createMyProviderAdapter } from './MusicSourceAdapter'

/** Опциональный SearchProvider — можно не экспортировать из index. */
export function createMySearchProvider(ctx: ProviderContext): SearchProvider {
  return {
    async search(query) {
      const adapter = createMyProviderAdapter(ctx)
      const result = await adapter.search(query)
      return result.tracks
    },
  }
}
