import { isSupportedAudioFileName } from './audioFormats.ts'
import type { IndexedLocalFile, LocalScanProgress } from './types.ts'

export type FileListImportResult = {
  files: IndexedLocalFile[]
  subdirectoryCount: number
  folderName: string
  totalFilesSeen: number
}

type ImportOptions = {
  signal?: AbortSignal
  onProgress?: (progress: LocalScanProgress) => void
  /** Имя папки, если относительных путей нет (выбор отдельных файлов). */
  fallbackFolderName?: string
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Scanning aborted', 'AbortError')
  }
}

function fileNameOf(file: File): string {
  const relative = file.webkitRelativePath?.trim()
  if (relative) {
    const parts = relative.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? file.name
  }
  return file.name
}

function relativePathOf(file: File): string {
  const relative = file.webkitRelativePath?.trim()
  if (relative) {
    return relative.replace(/\\/g, '/')
  }
  return file.name
}

function folderNameFromFiles(files: readonly File[], fallback: string): string {
  for (const file of files) {
    const relative = file.webkitRelativePath?.trim()
    if (!relative) {
      continue
    }
    const parts = relative.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length >= 2) {
      return parts[0]!
    }
  }
  return fallback
}

function countSubdirectories(paths: readonly string[]): number {
  const dirs = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join('/'))
    }
  }
  return dirs.size
}

/**
 * Индексация FileList без FileSystemDirectoryHandle.
 * Дубликаты по относительному пути отбрасываются.
 */
export function importAudioFromFileList(
  list: FileList | readonly File[],
  options: ImportOptions = {},
): FileListImportResult {
  const { signal, onProgress } = options
  const fallbackFolderName = options.fallbackFolderName ?? 'Выбранные файлы'
  const raw = Array.from(list as ArrayLike<File>)

  onProgress?.({
    phase: 'counting',
    processedFiles: 0,
    totalFiles: raw.length,
    foundTracks: 0,
    message: 'Подсчёт файлов…',
  })

  assertNotAborted(signal)

  const byPath = new Map<string, IndexedLocalFile>()
  let processedFiles = 0

  for (const file of raw) {
    assertNotAborted(signal)
    processedFiles += 1
    const fileName = fileNameOf(file)
    if (!isSupportedAudioFileName(fileName)) {
      onProgress?.({
        phase: 'scanning',
        processedFiles,
        totalFiles: raw.length,
        foundTracks: byPath.size,
        message: `Сканирование… ${processedFiles} из ${raw.length} файлов`,
      })
      continue
    }
    const relativePath = relativePathOf(file)
    if (!byPath.has(relativePath)) {
      byPath.set(relativePath, {
        relativePath,
        fileName,
        file,
      })
    }
    onProgress?.({
      phase: 'scanning',
      processedFiles,
      totalFiles: raw.length,
      foundTracks: byPath.size,
      message: `Сканирование… ${processedFiles} из ${raw.length} файлов`,
    })
  }

  const files = [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )
  const folderName = folderNameFromFiles(raw, fallbackFolderName)
  const subdirectoryCount = countSubdirectories(files.map((item) => item.relativePath))

  onProgress?.({
    phase: 'done',
    processedFiles,
    totalFiles: raw.length,
    foundTracks: files.length,
    message: `Готово: ${files.length} треков`,
  })

  return {
    files,
    subdirectoryCount,
    folderName,
    totalFilesSeen: processedFiles,
  }
}
