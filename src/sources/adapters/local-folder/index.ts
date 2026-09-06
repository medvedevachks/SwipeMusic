import type { MusicSourceAdapter, SearchResult } from '../../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../../types'
import type { SourceType } from '../../../types/source'
import type { Track } from '../../../types/track'

/**
 * Заготовка локальной библиотеки (File System Access API — позже).
 * Пока не читает файлы — только архитектура.
 */
export class FileSystemMusicAdapter implements MusicSourceAdapter {
  readonly id: string
  readonly label: string
  readonly type: SourceType = 'filesystem'
  readonly kind: MusicSourceKind = 'local-folder'
  readonly capabilities: readonly MusicSourceCapability[] = [
    'browse',
    'library',
    'search',
  ]

  readonly supportsSearch = true
  readonly supportsStreaming = true
  readonly supportsPagination = false

  constructor(options?: { id?: string; label?: string }) {
    this.id = options?.id ?? 'local-folder'
    this.label = options?.label ?? 'Local Files'
  }

  async initialize(): Promise<void> {
    // Позже: запрос разрешения File System Access API / directory handle.
  }

  isAvailable(): boolean {
    return false
  }

  async dispose(): Promise<void> {}

  async fetchTracks(_params?: FetchTracksParams): Promise<FetchTracksResult> {
    return { tracks: [], nextCursor: null }
  }

  async search(
    _query: string,
    _params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult> {
    return { tracks: [], nextCursor: null }
  }

  async getTrack(_trackId: string): Promise<Track | null> {
    return null
  }

  async getStream(_track: Track): Promise<string> {
    throw new Error(
      `[${this.id}] File System Access API streaming is not implemented yet`,
    )
  }

  async getCover(_track: Track): Promise<string | undefined> {
    return undefined
  }
}

/** @deprecated Используйте FileSystemMusicAdapter. */
export function createLocalFolderAdapter(): MusicSourceAdapter {
  return new FileSystemMusicAdapter()
}

/** @deprecated Используйте FileSystemMusicAdapter. */
export function createLocalFolderAdapterStub(): MusicSourceAdapter {
  return new FileSystemMusicAdapter()
}
