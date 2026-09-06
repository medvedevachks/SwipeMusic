import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/**
 * Заготовка адаптера локальной папки / файловой системы.
 * Позже: File System Access API / native bridge.
 */
export function createLocalFolderAdapter(): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: 'local-folder',
    label: 'Локальная папка',
    kind: 'local-folder',
    capabilities: ['browse', 'library'],
  })
}

/** @deprecated Используйте createLocalFolderAdapter. */
export function createLocalFolderAdapterStub(): MusicSourceAdapter {
  return createLocalFolderAdapter()
}
