import { create } from 'zustand'
import { pluginRegistry } from '../sdk'
import {
  bootstrapMusicSources,
  sourceManager,
  type CreateSourceInput,
  type SourceConfig,
} from '../sources'

type SourceManagerStore = {
  sources: SourceConfig[]
  addSource: (input: CreateSourceInput) => SourceConfig
  removeSource: (id: string) => void
  enableSource: (id: string) => void
  disableSource: (id: string) => void
  refresh: () => void
}

bootstrapMusicSources()

export const useSourceManagerStore = create<SourceManagerStore>((set) => {
  sourceManager.subscribe((sources) => {
    pluginRegistry.syncEnabledFromSourceManager()
    set({ sources })
  })

  return {
    sources: sourceManager.listSources(),

    addSource: (input) => {
      const created = sourceManager.addSource(input)
      set({ sources: sourceManager.listSources() })
      return created
    },

    removeSource: (id) => {
      sourceManager.removeSource(id)
      set({ sources: sourceManager.listSources() })
    },

    enableSource: (id) => {
      if (pluginRegistry.has(id)) {
        pluginRegistry.enable(id)
      } else {
        sourceManager.enableSource(id)
      }
      set({ sources: sourceManager.listSources() })
    },

    disableSource: (id) => {
      if (pluginRegistry.has(id)) {
        pluginRegistry.disable(id)
      } else {
        sourceManager.disableSource(id)
      }
      set({ sources: sourceManager.listSources() })
    },

    refresh: () => {
      set({ sources: sourceManager.listSources() })
    },
  }
})
