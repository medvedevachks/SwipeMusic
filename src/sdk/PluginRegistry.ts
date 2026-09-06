import { registerLibraryProvider } from '../library/LibraryProviderRegistry'
import { libraryProviderRegistry } from '../library/LibraryProviderRegistry'
import type { MusicSourceAdapter } from '../sources/MusicSourceAdapter'
import { sourceManager } from '../sources/SourceManager'
import { sourceRegistry } from '../sources/registry'
import { normalizeSourceType } from '../types/source'
import { createProviderContext } from './createProviderContext'
import { platformEventBus } from './EventBus'
import type {
  ProviderCapabilities,
  ProviderManifest,
  ProviderPlugin,
} from './types'

type RegisteredPluginState = {
  plugin: ProviderPlugin
  enabled: boolean
  adapter: MusicSourceAdapter
}

/**
 * Единый реестр ProviderPlugin.
 * Регистрация адаптера и LibraryProvider — через этот слой.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPluginState>()
  private bootstrapped = false

  register(plugin: ProviderPlugin): void {
    const id = plugin.manifest.id
    if (this.plugins.has(id)) {
      return
    }

    sourceManager.bootstrap()
    const ctx = createProviderContext(id)

    let adapter: MusicSourceAdapter
    if (sourceRegistry.has(id)) {
      adapter = sourceRegistry.get(id)
    } else {
      adapter = plugin.createMusicSourceAdapter(ctx)
      sourceRegistry.register(adapter)
    }

    const existingConfig = sourceManager
      .listSources()
      .find((source) => source.id === id)

    const enabled =
      existingConfig?.enabled ?? plugin.manifest.defaultEnabled ?? false

    this.plugins.set(id, {
      plugin,
      enabled,
      adapter,
    })

    if (!existingConfig) {
      sourceManager.addSource(
        {
          id,
          name: plugin.manifest.name,
          type: normalizeSourceType(adapter.type),
          enabled,
          priority: plugin.manifest.defaultPriority ?? 100,
        },
        adapter,
      )
    }

    if (plugin.createLibraryProvider) {
      const libraryProvider = plugin.createLibraryProvider(ctx)
      if (
        libraryProvider &&
        !libraryProviderRegistry.has(libraryProvider.id)
      ) {
        registerLibraryProvider(libraryProvider)
      }
    }

    platformEventBus.emit('PluginRegistered', { pluginId: id })
  }

  getPlugin(id: string): ProviderPlugin {
    const state = this.plugins.get(id)
    if (!state) {
      throw new Error(`Provider plugin "${id}" is not registered`)
    }
    return state.plugin
  }

  has(id: string): boolean {
    return this.plugins.has(id)
  }

  list(): ProviderPlugin[] {
    return [...this.plugins.values()].map((state) => state.plugin)
  }

  getEnabledPlugins(): ProviderPlugin[] {
    return [...this.plugins.values()]
      .filter((state) => state.enabled)
      .map((state) => state.plugin)
  }

  getManifest(id: string): ProviderManifest {
    return this.getPlugin(id).manifest
  }

  getCapabilities(id: string): ProviderCapabilities | null {
    const state = this.plugins.get(id)
    return state?.plugin.manifest.capabilities ?? null
  }

  enable(id: string): void {
    const state = this.plugins.get(id)
    if (!state) {
      throw new Error(`Provider plugin "${id}" is not registered`)
    }
    state.enabled = true
    sourceManager.enableSource(id)
    platformEventBus.emit('SourceEnabled', { sourceId: id })
  }

  disable(id: string): void {
    const state = this.plugins.get(id)
    if (!state) {
      throw new Error(`Provider plugin "${id}" is not registered`)
    }
    state.enabled = false
    sourceManager.disableSource(id)
    platformEventBus.emit('SourceDisabled', { sourceId: id })
  }

  isEnabled(id: string): boolean {
    return this.plugins.get(id)?.enabled ?? false
  }

  /** Синхронизация enabled-флага из SourceManager (после UI toggle). */
  syncEnabledFromSourceManager(): void {
    for (const config of sourceManager.listSources()) {
      const state = this.plugins.get(config.id)
      if (state) {
        state.enabled = config.enabled
      }
    }
  }

  markBootstrapped(): void {
    this.bootstrapped = true
  }

  isBootstrapped(): boolean {
    return this.bootstrapped
  }
}

export const pluginRegistry = new PluginRegistry()

export function registerPlugin(plugin: ProviderPlugin): void {
  pluginRegistry.register(plugin)
}

export function getPlugin(id: string): ProviderPlugin {
  return pluginRegistry.getPlugin(id)
}

export function getEnabledPlugins(): ProviderPlugin[] {
  return pluginRegistry.getEnabledPlugins()
}

export function enablePlugin(id: string): void {
  pluginRegistry.enable(id)
}

export function disablePlugin(id: string): void {
  pluginRegistry.disable(id)
}
