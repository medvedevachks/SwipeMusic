import {
  AdapterLibraryProvider,
} from '../library/providers/AdapterLibraryProvider'
import {
  createStubLibraryProvider,
} from '../library/providers/createStubLibraryProvider'
import {
  HierarchicalPathLibraryProvider,
} from '../library/providers/HierarchicalPathLibraryProvider'
import type { MusicSourceAdapter } from '../sources/MusicSourceAdapter'
import { sourceManager } from '../sources/SourceManager'
import {
  pluginRegistry,
  registerPlugin,
} from './PluginRegistry'
import { platformEventBus } from './EventBus'
import { builtinProviderPlugins } from './builtin/builtinPlugins'
import type { ProviderCapabilities, ProviderPlugin } from './types'

function capabilitiesFromAdapter(
  adapter: MusicSourceAdapter,
): ProviderCapabilities {
  return {
    search: adapter.supportsSearch,
    library: true,
    streaming: adapter.supportsStreaming,
    download: false,
    artwork: false,
    authentication: false,
    lyrics: false,
    previewPlayback: false,
  }
}

function libraryProviderForAdapter(adapter: MusicSourceAdapter) {
  if (adapter.type === 'filesystem') {
    return new HierarchicalPathLibraryProvider(adapter)
  }
  if (adapter.id === 'mock' || adapter.kind === 'mock') {
    return new AdapterLibraryProvider(adapter)
  }
  return createStubLibraryProvider({
    id: adapter.id,
    label: adapter.label,
  })
}

/**
 * Регистрирует адаптер как ProviderPlugin.
 * Обратная совместимость для registerMusicSource().
 */
export function pluginFromAdapter(
  adapter: MusicSourceAdapter,
  overrides?: Partial<ProviderPlugin['manifest']>,
): ProviderPlugin {
  return {
    manifest: {
      id: adapter.id,
      name: adapter.label,
      version: '0.0.0',
      defaultEnabled: false,
      defaultPriority: 100,
      capabilities: capabilitiesFromAdapter(adapter),
      ...overrides,
    },
    createMusicSourceAdapter: () => adapter,
    createLibraryProvider: () => libraryProviderForAdapter(adapter),
  }
}

/** Регистрация всех встроенных плагинов (idempotent). */
export function bootstrapProviderPlugins(): void {
  sourceManager.bootstrap()

  for (const plugin of builtinProviderPlugins) {
    registerPlugin(plugin)
  }

  pluginRegistry.syncEnabledFromSourceManager()

  if (!pluginRegistry.isBootstrapped()) {
    platformEventBus.on('SourceAuthenticated', ({ sourceId }) => {
      if (!sourceManager.listSources().some((source) => source.id === sourceId)) {
        return
      }
      sourceManager.enableSource(sourceId)
      pluginRegistry.syncEnabledFromSourceManager()
    })
    pluginRegistry.markBootstrapped()
  }
}
