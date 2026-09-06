import type { ProviderPlugin, SearchProvider } from '../../src/sdk'
import { createMyLibraryProvider } from './LibraryProvider'
import { createMyProviderAdapter } from './MusicSourceAdapter'
import { MY_PROVIDER_MANIFEST } from './manifest'

/**
 * Готовый ProviderPlugin для регистрации:
 *
 *   import { registerPlugin } from '../../src/sdk'
 *   import { myProviderPlugin } from '../providers/_template'
 *   registerPlugin(myProviderPlugin)
 */
export const myProviderPlugin: ProviderPlugin = {
  manifest: MY_PROVIDER_MANIFEST,

  createMusicSourceAdapter: (ctx) => createMyProviderAdapter(ctx),

  createLibraryProvider: (ctx) => createMyLibraryProvider(ctx),

  createSearchProvider: (ctx): SearchProvider => ({
    async search(query) {
      const adapter = createMyProviderAdapter(ctx)
      const result = await adapter.search(query)
      return result.tracks
    },
  }),
}

export { MY_PROVIDER_MANIFEST } from './manifest'
