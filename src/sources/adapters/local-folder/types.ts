export type LocalAccessState =
  | 'unsupported'
  | 'idle'
  | 'granted'
  | 'prompt'
  | 'denied'

/** Постоянный directory handle или временный FileList до перезагрузки. */
export type LocalLibraryMode = 'handle' | 'session-files'

export type LocalScanProgress = {
  phase: 'idle' | 'counting' | 'scanning' | 'done' | 'error'
  /** Сколько файлов уже обработано на текущем проходе. */
  processedFiles: number
  /** Оценка / итог числа файлов (после counting). */
  totalFiles: number
  /** Найдено аудиофайлов. */
  foundTracks: number
  message?: string
}

export type LocalLibraryStats = {
  folderName: string | null
  trackCount: number
  subdirectoryCount: number
  lastScanAt: number | null
  accessState: LocalAccessState
  libraryMode: LocalLibraryMode | null
  /** После перезагрузки для session-files: нужна повторная выдача файлов. */
  reselectRequired: boolean
}

export type LocalLibrarySnapshot = {
  folderName: string
  trackCount: number
  subdirectoryCount: number
  lastScanAt: number
  /** Относительные пути файлов — для диагностики / будущей быстрой переиндексации. */
  relativePaths: string[]
  libraryMode?: LocalLibraryMode
}

export type IndexedLocalFile = {
  /** Стабильный ключ внутри источника: относительный путь. */
  relativePath: string
  fileName: string
  /** Постоянный handle из File System Access API. */
  handle?: FileSystemFileHandle
  /** Временный File из FileList — только в памяти сессии. */
  file?: File
}

export type LocalLibraryListener = (stats: LocalLibraryStats) => void
export type LocalScanProgressListener = (progress: LocalScanProgress) => void
