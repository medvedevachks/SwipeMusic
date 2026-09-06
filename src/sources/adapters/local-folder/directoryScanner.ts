import { isSupportedAudioFileName } from './audioFormats'
import type { IndexedLocalFile, LocalScanProgress } from './types'

export type DirectoryScanResult = {
  files: IndexedLocalFile[]
  subdirectoryCount: number
  totalFilesSeen: number
}

type ScanOptions = {
  signal?: AbortSignal
  onProgress?: (progress: LocalScanProgress) => void
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Scanning aborted', 'AbortError')
  }
}

async function countEntries(
  root: FileSystemDirectoryHandle,
  signal?: AbortSignal,
): Promise<{ totalFiles: number; subdirectoryCount: number }> {
  let totalFiles = 0
  let subdirectoryCount = 0

  async function walk(dir: FileSystemDirectoryHandle): Promise<void> {
    assertNotAborted(signal)
    for await (const handle of dir.values()) {
      assertNotAborted(signal)
      if (handle.kind === 'directory') {
        subdirectoryCount += 1
        await walk(handle as FileSystemDirectoryHandle)
      } else if (handle.kind === 'file') {
        totalFiles += 1
      }
    }
  }

  await walk(root)
  return { totalFiles, subdirectoryCount }
}

/**
 * Двухпроходное сканирование: сначала счётчик файлов, затем индексация аудио.
 * Не читает содержимое файлов — только имена и handles.
 */
export async function scanDirectoryForAudio(
  root: FileSystemDirectoryHandle,
  options: ScanOptions = {},
): Promise<DirectoryScanResult> {
  const { signal, onProgress } = options

  onProgress?.({
    phase: 'counting',
    processedFiles: 0,
    totalFiles: 0,
    foundTracks: 0,
    message: 'Подсчёт файлов…',
  })

  const { totalFiles, subdirectoryCount } = await countEntries(root, signal)

  onProgress?.({
    phase: 'scanning',
    processedFiles: 0,
    totalFiles,
    foundTracks: 0,
    message: 'Сканирование…',
  })

  const files: IndexedLocalFile[] = []
  let processedFiles = 0

  async function walk(
    dir: FileSystemDirectoryHandle,
    relativePrefix: string,
  ): Promise<void> {
    assertNotAborted(signal)

    for await (const [name, handle] of dir.entries()) {
      assertNotAborted(signal)

      if (handle.kind === 'directory') {
        const nextPrefix = relativePrefix ? `${relativePrefix}/${name}` : name
        await walk(handle as FileSystemDirectoryHandle, nextPrefix)
        continue
      }

      if (handle.kind !== 'file') {
        continue
      }

      processedFiles += 1

      if (isSupportedAudioFileName(name)) {
        const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name
        files.push({
          relativePath,
          fileName: name,
          handle: handle as FileSystemFileHandle,
        })
      }

      onProgress?.({
        phase: 'scanning',
        processedFiles,
        totalFiles,
        foundTracks: files.length,
        message: `Сканирование… ${processedFiles} из ${totalFiles} файлов`,
      })
    }
  }

  await walk(root, '')

  onProgress?.({
    phase: 'done',
    processedFiles,
    totalFiles,
    foundTracks: files.length,
    message: `Готово: ${files.length} треков`,
  })

  return {
    files,
    subdirectoryCount,
    totalFilesSeen: processedFiles,
  }
}
