export type LocalAccessState =
  | 'unsupported'
  | 'idle'
  | 'granted'
  | 'prompt'
  | 'denied'

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
}

export type LocalLibrarySnapshot = {
  folderName: string
  trackCount: number
  subdirectoryCount: number
  lastScanAt: number
  /** Относительные пути файлов — для диагностики / будущей быстрой переиндексации. */
  relativePaths: string[]
}

export type IndexedLocalFile = {
  /** Стабильный ключ внутри источника: относительный путь. */
  relativePath: string
  fileName: string
  handle: FileSystemFileHandle
}

export type LocalLibraryListener = (stats: LocalLibraryStats) => void
export type LocalScanProgressListener = (progress: LocalScanProgress) => void
