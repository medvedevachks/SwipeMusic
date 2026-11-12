import { bootstrapMusicSources, sourceManager } from '../../sources/index.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import { pluginRegistry } from '../../sdk/index.ts'
import type { SearchEnginePorts } from './SearchEngine.ts'

/** Production ports: SourceManager + PluginRegistry. */
export function createDefaultSearchEnginePorts(): SearchEnginePorts {
  return {
    bootstrap: () => {
      bootstrapMusicSources()
    },
    listEnabledSources: () =>
      sourceManager.listEnabledSources().map((source) => ({
        id: source.id,
        name: source.name,
        priority: source.priority,
      })),
    getAdapter: (id) => sourceManager.getAdapter(id),
    getCapabilities: (id) => pluginRegistry.getCapabilities(id),
    getSearchProvider: (id) => pluginRegistry.getSearchProvider(id),
    isDemoSourceId,
  }
}
