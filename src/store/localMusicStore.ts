import { create } from 'zustand'
import {
  bootstrapMusicSources,
  getFileSystemMusicAdapter,
  sourceManager,
} from '../sources'
import type {
  LocalLibraryStats,
  LocalScanProgress,
} from '../sources/adapters/local-folder'
import { useSourceManagerStore } from './sourceManagerStore'

type LocalMusicStore = {
  stats: LocalLibraryStats
  progress: LocalScanProgress
  isBusy: boolean
  error: string | null
  libraryGeneration: number
  connectFolder: () => Promise<void>
  requestAccess: () => Promise<void>
  rescan: () => Promise<void>
  disconnect: () => Promise<void>
}

const idleProgress: LocalScanProgress = {
  phase: 'idle',
  processedFiles: 0,
  totalFiles: 0,
  foundTracks: 0,
}

function emptyStats(): LocalLibraryStats {
  return getFileSystemMusicAdapter().getStats()
}

function syncEnabledFromAdapter(): void {
  const adapter = getFileSystemMusicAdapter()
  try {
    if (adapter.isAvailable()) {
      sourceManager.enableSource(adapter.id)
    }
  } catch {
    // ignore
  }
  useSourceManagerStore.getState().refresh()
}

bootstrapMusicSources()

const adapter = getFileSystemMusicAdapter()

export const useLocalMusicStore = create<LocalMusicStore>((set, get) => {
  void adapter.initialize().then(() => {
    syncEnabledFromAdapter()
    set({
      stats: adapter.getStats(),
      progress: adapter.getScanProgress(),
      libraryGeneration: get().libraryGeneration + 1,
    })
  })

  adapter.subscribeStats((stats) => {
    set({ stats })
  })

  adapter.subscribeScanProgress((progress) => {
    set({ progress })
  })

  return {
    stats: emptyStats(),
    progress: idleProgress,
    isBusy: false,
    error: null,
    libraryGeneration: 0,

    connectFolder: async () => {
      set({ isBusy: true, error: null })
      try {
        await adapter.connectFolder()
        syncEnabledFromAdapter()
        set({
          stats: adapter.getStats(),
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set({ isBusy: false })
          return
        }
        set({
          error: error instanceof Error ? error.message : 'Не удалось выбрать папку',
        })
      } finally {
        set({ isBusy: false, progress: adapter.getScanProgress() })
      }
    },

    requestAccess: async () => {
      set({ isBusy: true, error: null })
      try {
        await adapter.requestAccess()
        syncEnabledFromAdapter()
        set({
          stats: adapter.getStats(),
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set({ isBusy: false })
          return
        }
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось получить доступ к папке',
        })
      } finally {
        set({ isBusy: false, progress: adapter.getScanProgress() })
      }
    },

    rescan: async () => {
      set({ isBusy: true, error: null })
      try {
        await adapter.rescan()
        syncEnabledFromAdapter()
        set({
          stats: adapter.getStats(),
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        set({
          error:
            error instanceof Error ? error.message : 'Ошибка пересканирования',
        })
      } finally {
        set({ isBusy: false, progress: adapter.getScanProgress() })
      }
    },

    disconnect: async () => {
      set({ isBusy: true, error: null })
      try {
        await adapter.disconnect()
        try {
          sourceManager.disableSource(adapter.id)
        } catch {
          // ignore
        }
        useSourceManagerStore.getState().refresh()
        set({
          stats: adapter.getStats(),
          progress: idleProgress,
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось отключить библиотеку',
        })
      } finally {
        set({ isBusy: false })
      }
    },
  }
})
