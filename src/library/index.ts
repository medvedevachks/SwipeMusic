import { bootstrapMusicSources, listMusicSources } from '../sources'
import { FileSystemMusicAdapter } from '../sources/adapters/local-folder'
import { registerLibraryProvider } from './LibraryProviderRegistry'
import { AdapterLibraryProvider } from './providers/AdapterLibraryProvider'
import { createStubLibraryProvider } from './providers/createStubLibraryProvider'
import { HierarchicalPathLibraryProvider } from './providers/HierarchicalPathLibraryProvider'
import { SmartLibraryProvider } from './providers/SmartLibraryProvider'
import { libraryProviderRegistry } from './LibraryProviderRegistry'

let bootstrapped = false

/**
 * Регистрирует LibraryProvider для умных коллекций и каждого MusicSourceAdapter.
 * Новый источник → новый провайдер, без правок UI.
 */
export function bootstrapLibraryProviders(): void {
  if (bootstrapped) {
    return
  }

  bootstrapMusicSources()

  registerLibraryProvider(new SmartLibraryProvider())

  for (const adapter of listMusicSources()) {
    if (libraryProviderRegistry.has(adapter.id)) {
      continue
    }

    if (adapter instanceof FileSystemMusicAdapter || adapter.type === 'filesystem') {
      registerLibraryProvider(new HierarchicalPathLibraryProvider(adapter))
      continue
    }

    if (adapter.id === 'mock' || adapter.isAvailable()) {
      registerLibraryProvider(new AdapterLibraryProvider(adapter))
      continue
    }

    // Заглушки для официальных / scraper-источников до реальной интеграции.
    registerLibraryProvider(
      createStubLibraryProvider({
        id: adapter.id,
        label: adapter.label,
      }),
    )
  }

  bootstrapped = true
}

export { libraryService } from './LibraryService'
export { registerLibraryProvider, libraryProviderRegistry } from './LibraryProviderRegistry'
export type { LibraryProvider, LibraryNode } from '../types/libraryProvider'
