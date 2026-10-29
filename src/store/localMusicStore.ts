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
import { openLocalFilePicker } from '../sources/adapters/local-folder/localFilePicker'
import { useSourceManagerStore } from './sourceManagerStore'

type LocalMusicStore = {
  stats: LocalLibraryStats
  progress: LocalScanProgress
  isBusy: boolean
  error: string | null
  libraryGeneration: number
  connectFolder: () => Promise<void>
  connectFolderViaFileInput: () => Promise<void>
  connectAudioFiles: () => Promise<void>
  requestAccess: () => Promise<void>
  rescan: () => Promise<void>
  disconnect: () => Promise<void>
}

function describeDirectoryPickerAbort(): string {
  return 'Выбор папки отменён или системный диалог не открылся. Попробуйте «Выбрать папку другим способом».'
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
          set({
            isBusy: false,
            error: describeDirectoryPickerAbort(),
            progress: adapter.getScanProgress(),
          })
          return
        }
        set({
          error: error instanceof Error ? error.message : 'Не удалось выбрать папку',
        })
      } finally {
        set({ isBusy: false, progress: adapter.getScanProgress() })
      }
    },

    connectFolderViaFileInput: async () => {
      set({ isBusy: true, error: null })
      try {
        const picked = await openLocalFilePicker('directory')
        if (picked.status === 'cancelled') {
          set({
            isBusy: false,
            error: 'Выбор папки отменён.',
            progress: adapter.getScanProgress(),
          })
          return
        }
        if (picked.status === 'unavailable') {
          set({ isBusy: false, error: picked.message })
          return
        }
        await adapter.connectFromFileList(picked.files, {
          fallbackFolderName: 'Выбранная папка',
        })
        syncEnabledFromAdapter()
        set({
          stats: adapter.getStats(),
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set({
            isBusy: false,
            error: 'Импорт папки прерван.',
            progress: adapter.getScanProgress(),
          })
          return
        }
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось импортировать папку',
        })
      } finally {
        set({ isBusy: false, progress: adapter.getScanProgress() })
      }
    },

    connectAudioFiles: async () => {
      set({ isBusy: true, error: null })
      try {
        const picked = await openLocalFilePicker('audio-files')
        if (picked.status === 'cancelled') {
          set({
            isBusy: false,
            error: 'Выбор аудиофайлов отменён.',
            progress: adapter.getScanProgress(),
          })
          return
        }
        if (picked.status === 'unavailable') {
          set({ isBusy: false, error: picked.message })
          return
        }
        await adapter.connectFromFileList(picked.files, {
          fallbackFolderName: 'Выбранные файлы',
        })
        syncEnabledFromAdapter()
        set({
          stats: adapter.getStats(),
          libraryGeneration: get().libraryGeneration + 1,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          set({
            isBusy: false,
            error: 'Импорт аудиофайлов прерван.',
            progress: adapter.getScanProgress(),
          })
          return
        }
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось импортировать аудиофайлы',
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
          set({
            isBusy: false,
            error: describeDirectoryPickerAbort(),
            progress: adapter.getScanProgress(),
          })
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
        if (error instanceof DOMException && error.name === 'AbortError') {
          set({
            isBusy: false,
            error: 'Пересканирование прервано.',
            progress: adapter.getScanProgress(),
          })
          return
        }
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
