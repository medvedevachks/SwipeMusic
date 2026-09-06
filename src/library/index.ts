import { bootstrapMusicSources } from '../sources'
import { registerLibraryProvider } from './LibraryProviderRegistry'
import { SmartLibraryProvider } from './providers/SmartLibraryProvider'
import { libraryProviderRegistry } from './LibraryProviderRegistry'

let bootstrapped = false

/**
 * Регистрирует LibraryProvider.
 * Источниковые провайдеры приходят из ProviderPlugin SDK;
 * здесь — только Smart (Favorites / Recent / Categories).
 */
export function bootstrapLibraryProviders(): void {
  if (bootstrapped) {
    return
  }

  bootstrapMusicSources()

  if (!libraryProviderRegistry.has('smart')) {
    registerLibraryProvider(new SmartLibraryProvider())
  }

  bootstrapped = true
}

export { libraryService } from './LibraryService'
export { registerLibraryProvider, libraryProviderRegistry } from './LibraryProviderRegistry'
export type { LibraryProvider, LibraryNode } from '../types/libraryProvider'
