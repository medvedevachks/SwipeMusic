import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { FetchTracksResult } from '../../types'

/**
 * Заготовка адаптера локальной папки / файловой системы.
 * Позже: File System Access API / native bridge.
 */
export function createLocalFolderAdapterStub(): MusicSourceAdapter {
  return {
    id: 'local-folder',
    label: 'Local folder',
    kind: 'local-folder',
    capabilities: ['browse', 'library'],

    isAvailable() {
      return false
    },

    async fetchTracks(): Promise<FetchTracksResult> {
      throw new Error('[local-folder] Local folder adapter is not configured yet')
    },
  }
}
