import { createTrack } from '../../normalizeTrack'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../../types'
import type { MusicSourceAdapter, SearchResult } from '../../MusicSourceAdapter'
import type { SourceType } from '../../../types/source'
import type { Track } from '../../../types/track'
import { stripFileExtension, mimeTypeForAudioFileName } from './audioFormats'
import { scanDirectoryForAudio } from './directoryScanner'
import {
  clearLocalLibraryStorage,
  loadDirectoryHandle,
  loadLibrarySnapshot,
  saveDirectoryHandle,
  saveLibrarySnapshot,
} from './handleStorage'
import { ObjectUrlCache } from './ObjectUrlCache'
import { getMediaIndex, indexTracksForSource } from '../../../services/mediaIndex'
import type {
  IndexedLocalFile,
  LocalAccessState,
  LocalLibraryListener,
  LocalLibrarySnapshot,
  LocalLibraryStats,
  LocalScanProgress,
  LocalScanProgressListener,
} from './types'

const UNKNOWN_ARTIST = 'Unknown Artist'
const COVER_COLOR = '#0f766e'

function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    typeof indexedDB !== 'undefined'
  )
}

async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  if (typeof handle.queryPermission !== 'function') {
    return 'granted'
  }
  return handle.queryPermission({ mode: 'read' })
}

async function ensureHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const current = await queryHandlePermission(handle)
  if (current === 'granted') {
    return current
  }
  if (typeof handle.requestPermission !== 'function') {
    return current
  }
  return handle.requestPermission({ mode: 'read' })
}

/**
 * Полноценный источник локальной музыки через File System Access API.
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

  private readonly urlCache = new ObjectUrlCache()
  private readonly filesByPath = new Map<string, IndexedLocalFile>()
  private readonly tracksById = new Map<string, Track>()
  private readonly statsListeners = new Set<LocalLibraryListener>()
  private readonly progressListeners = new Set<LocalScanProgressListener>()

  private directoryHandle: FileSystemDirectoryHandle | null = null
  private folderName: string | null = null
  private subdirectoryCount = 0
  private lastScanAt: number | null = null
  accessState: LocalAccessState = 'idle'
  private scanProgress: LocalScanProgress = {
    phase: 'idle',
    processedFiles: 0,
    totalFiles: 0,
    foundTracks: 0,
  }
  private scanAbort: AbortController | null = null
  private initPromise: Promise<void> | null = null

  constructor(options?: { id?: string; label?: string }) {
    this.id = options?.id ?? 'local-folder'
    this.label = options?.label ?? 'Local Music'
    this.accessState = isFileSystemAccessSupported() ? 'idle' : 'unsupported'
  }

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.restoreFromStorage()
    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  isAvailable(): boolean {
    return (
      this.accessState === 'granted' &&
      this.directoryHandle !== null &&
      this.tracksById.size > 0
    )
  }

  async dispose(): Promise<void> {
    this.scanAbort?.abort()
    this.scanAbort = null
    this.clearIndexedData()
    this.statsListeners.clear()
    this.progressListeners.clear()
  }

  getStats(): LocalLibraryStats {
    return {
      folderName: this.folderName,
      trackCount: this.tracksById.size,
      subdirectoryCount: this.subdirectoryCount,
      lastScanAt: this.lastScanAt,
      accessState: this.accessState,
    }
  }

  getScanProgress(): LocalScanProgress {
    return { ...this.scanProgress }
  }

  subscribeStats(listener: LocalLibraryListener): () => void {
    this.statsListeners.add(listener)
    listener(this.getStats())
    return () => {
      this.statsListeners.delete(listener)
    }
  }

  subscribeScanProgress(listener: LocalScanProgressListener): () => void {
    this.progressListeners.add(listener)
    listener(this.getScanProgress())
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  /** Выбор папки пользователем + первичное сканирование. */
  async connectFolder(): Promise<LocalLibraryStats> {
    if (!isFileSystemAccessSupported()) {
      this.accessState = 'unsupported'
      this.emitStats()
      throw new Error(
        'File System Access API не поддерживается в этом браузере',
      )
    }

    const showDirectoryPicker = window.showDirectoryPicker.bind(window)
    const handle = await showDirectoryPicker({
      id: 'swipe-music-library',
      mode: 'read',
      startIn: 'music',
    })

    const permission = await ensureHandlePermission(handle)
    if (permission !== 'granted') {
      this.accessState = permission === 'denied' ? 'denied' : 'prompt'
      this.emitStats()
      throw new Error('Нет разрешения на чтение папки')
    }

    this.directoryHandle = handle
    this.folderName = handle.name
    this.accessState = 'granted'
    await saveDirectoryHandle(handle)

    await this.runScan(handle)
    return this.getStats()
  }

  /** Повторный запрос разрешения для сохранённого handle. */
  async requestAccess(): Promise<LocalLibraryStats> {
    if (!this.directoryHandle) {
      return this.connectFolder()
    }

    const permission = await ensureHandlePermission(this.directoryHandle)
    if (permission !== 'granted') {
      this.accessState = permission === 'denied' ? 'denied' : 'prompt'
      this.emitStats()
      throw new Error('Разрешение не получено')
    }

    this.accessState = 'granted'
    await this.runScan(this.directoryHandle)
    return this.getStats()
  }

  async rescan(): Promise<LocalLibraryStats> {
    if (!this.directoryHandle) {
      throw new Error('Папка не подключена')
    }

    const permission = await ensureHandlePermission(this.directoryHandle)
    if (permission !== 'granted') {
      this.accessState = permission === 'denied' ? 'denied' : 'prompt'
      this.emitStats()
      throw new Error('Требуется повторное разрешение на доступ к папке')
    }

    this.accessState = 'granted'
    await this.runScan(this.directoryHandle)
    return this.getStats()
  }

  async disconnect(): Promise<void> {
    this.scanAbort?.abort()
    this.scanAbort = null
    this.directoryHandle = null
    this.folderName = null
    this.subdirectoryCount = 0
    this.lastScanAt = null
    this.accessState = isFileSystemAccessSupported() ? 'idle' : 'unsupported'
    this.clearIndexedData()
    this.setProgress({
      phase: 'idle',
      processedFiles: 0,
      totalFiles: 0,
      foundTracks: 0,
    })
    await clearLocalLibraryStorage()
    getMediaIndex().replaceSource(this.id, [])
    this.emitStats()
  }

  async fetchTracks(params?: FetchTracksParams): Promise<FetchTracksResult> {
    // ObjectURL создаём только в getStream — иначе в кэшах остаются revoked blob: URL.
    const tracks = [...this.tracksById.values()]
    const limit = params?.limit ?? tracks.length
    return {
      tracks: tracks.slice(0, limit),
      nextCursor: null,
    }
  }

  async search(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult> {
    const normalized = query.trim().toLowerCase()
    const tracks = [...this.tracksById.values()]
    const filtered = normalized
      ? tracks.filter(
          (track) =>
            track.title.toLowerCase().includes(normalized) ||
            track.artist.toLowerCase().includes(normalized) ||
            (track.album?.toLowerCase().includes(normalized) ?? false),
        )
      : tracks
    const limit = params?.limit ?? filtered.length
    return {
      tracks: filtered.slice(0, limit),
      nextCursor: null,
    }
  }

  async getTrack(trackId: string): Promise<Track | null> {
    return (
      [...this.tracksById.values()].find(
        (track) => track.id === trackId || track.externalId === trackId,
      ) ?? null
    )
  }

  async getStream(track: Track): Promise<string> {
    const externalId = this.resolveExternalId(track)
    const url = await this.ensureObjectUrl(externalId)
    return url
  }

  async getPlaybackCandidates(track: Track) {
    try {
      const url = await this.getStream(track)
      return [
        {
          id: `${this.id}:local`,
          providerId: this.id,
          type: 'local' as const,
          priority: 0,
          available: Boolean(url),
          url,
          label: 'Local file',
        },
      ]
    } catch (error) {
      return [
        {
          id: `${this.id}:local`,
          providerId: this.id,
          type: 'local' as const,
          priority: 0,
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      ]
    }
  }

  async getCover(_track: Track): Promise<string | undefined> {
    return undefined
  }

  private async restoreFromStorage(): Promise<void> {
    if (!isFileSystemAccessSupported()) {
      this.accessState = 'unsupported'
      this.emitStats()
      return
    }

    const handle = await loadDirectoryHandle()
    const snapshot = await loadLibrarySnapshot()

    if (!handle) {
      this.accessState = 'idle'
      this.emitStats()
      return
    }

    this.directoryHandle = handle
    this.folderName = handle.name || snapshot?.folderName || null

    let permission: PermissionState
    try {
      permission = await queryHandlePermission(handle)
    } catch {
      this.accessState = 'prompt'
      this.emitStats()
      return
    }

    if (permission === 'granted') {
      this.accessState = 'granted'
      try {
        await this.runScan(handle)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        this.accessState = 'prompt'
        this.emitStats()
      }
      return
    }

    this.accessState = permission === 'denied' ? 'denied' : 'prompt'
    if (snapshot) {
      this.subdirectoryCount = snapshot.subdirectoryCount
      this.lastScanAt = snapshot.lastScanAt
      this.folderName = snapshot.folderName
    }
    this.emitStats()
  }

  private async runScan(handle: FileSystemDirectoryHandle): Promise<void> {
    this.scanAbort?.abort()
    const controller = new AbortController()
    this.scanAbort = controller

    this.clearIndexedData()

    try {
      const result = await scanDirectoryForAudio(handle, {
        signal: controller.signal,
        onProgress: (progress) => this.setProgress(progress),
      })

      this.subdirectoryCount = result.subdirectoryCount
      this.lastScanAt = Date.now()
      this.folderName = handle.name

      for (const file of result.files) {
        this.filesByPath.set(file.relativePath, file)
        const track = this.buildTrackShell(file)
        this.tracksById.set(track.id, track)
      }

      const snapshot: LocalLibrarySnapshot = {
        folderName: handle.name,
        trackCount: result.files.length,
        subdirectoryCount: result.subdirectoryCount,
        lastScanAt: this.lastScanAt,
        relativePaths: result.files.map((file) => file.relativePath),
      }
      await saveLibrarySnapshot(snapshot)
      this.emitStats()

      // Синхронизация в MediaIndex — Library/Search читают только оттуда.
      const mediaFiles = result.files.map((file) => ({
        sourceId: this.id,
        externalId: file.relativePath,
        path: file.relativePath,
        fileName: file.fileName,
      }))
      await indexTracksForSource(
        this.id,
        [...this.tracksById.values()],
        mediaFiles,
      )
    } catch (error) {
      this.setProgress({
        phase: 'error',
        processedFiles: this.scanProgress.processedFiles,
        totalFiles: this.scanProgress.totalFiles,
        foundTracks: this.tracksById.size,
        message: error instanceof Error ? error.message : 'Ошибка сканирования',
      })
      throw error
    } finally {
      if (this.scanAbort === controller) {
        this.scanAbort = null
      }
    }
  }

  private buildTrackShell(file: IndexedLocalFile): Track {
    return createTrack({
      sourceId: this.id,
      externalId: file.relativePath,
      title: stripFileExtension(file.fileName),
      artist: UNKNOWN_ARTIST,
      album: undefined,
      coverUrl: null,
      coverColor: COVER_COLOR,
      previewUrl: null,
    })
  }

  /** ObjectURL создаётся лениво в getStream / ensureObjectUrl. */
  private async ensureObjectUrl(externalId: string): Promise<string> {
    const cached = this.urlCache.get(externalId)
    if (cached) {
      return cached
    }

    const file = this.filesByPath.get(externalId)
    if (!file) {
      throw new Error(`[${this.id}] File not found: ${externalId}`)
    }

    const fileHandle = await file.handle.getFile()
    const mime =
      fileHandle.type ||
      mimeTypeForAudioFileName(file.fileName) ||
      'application/octet-stream'
    const blob =
      fileHandle.type === mime
        ? fileHandle
        : new Blob([fileHandle], { type: mime })
    const url = URL.createObjectURL(blob)
    return this.urlCache.set(externalId, url)
  }

  private resolveExternalId(track: Track): string {
    if (this.filesByPath.has(track.externalId)) {
      return track.externalId
    }
    if (track.id.startsWith(`${this.id}:`)) {
      return track.id.slice(this.id.length + 1)
    }
    return track.externalId
  }

  private clearIndexedData(): void {
    this.urlCache.clear()
    this.filesByPath.clear()
    this.tracksById.clear()
  }

  private setProgress(progress: LocalScanProgress): void {
    this.scanProgress = progress
    for (const listener of this.progressListeners) {
      listener({ ...progress })
    }
  }

  private emitStats(): void {
    const stats = this.getStats()
    for (const listener of this.statsListeners) {
      listener(stats)
    }
  }
}

let sharedAdapter: FileSystemMusicAdapter | null = null

/** Единый экземпляр для registry и UI. */
export function getFileSystemMusicAdapter(): FileSystemMusicAdapter {
  if (!sharedAdapter) {
    sharedAdapter = new FileSystemMusicAdapter()
  }
  return sharedAdapter
}

export function createLocalFolderAdapter(): MusicSourceAdapter {
  return getFileSystemMusicAdapter()
}

/** @deprecated */
export function createLocalFolderAdapterStub(): MusicSourceAdapter {
  return getFileSystemMusicAdapter()
}
