import type { LibraryProvider } from '../types/libraryProvider'

/**
 * Реестр LibraryProvider — регистрация одной строкой, без правок UI.
 */
export class LibraryProviderRegistry {
  private readonly providers = new Map<string, LibraryProvider>()

  register(provider: LibraryProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  get(id: string): LibraryProvider {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`LibraryProvider "${id}" is not registered`)
    }
    return provider
  }

  list(): LibraryProvider[] {
    return [...this.providers.values()]
  }
}

export const libraryProviderRegistry = new LibraryProviderRegistry()

export function registerLibraryProvider(provider: LibraryProvider): void {
  libraryProviderRegistry.register(provider)
}
