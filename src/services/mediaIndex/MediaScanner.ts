import type { MediaFile, MediaScanProgress } from './types'

export interface MediaScanner {
  scan(sourceId: string): Promise<MediaFile[]>
  rescan(sourceId: string): Promise<MediaFile[]>
  scanIncremental(sourceId: string): Promise<MediaFile[]>
  cancel(): void
  getProgress(): MediaScanProgress
}

type DiscoverFn = (
  sourceId: string,
  signal: AbortSignal,
  onProgress: (processed: number, total: number) => void,
) => Promise<MediaFile[]>

/**
 * Scanner только обнаруживает объекты. Метаданные — MetadataExtractor.
 */
export class DefaultMediaScanner implements MediaScanner {
  private abort: AbortController | null = null
  private progress: MediaScanProgress = {
    sourceId: '',
    phase: 'idle',
    processed: 0,
    total: 0,
  }
  private readonly discover: DiscoverFn

  constructor(discover: DiscoverFn) {
    this.discover = discover
  }

  getProgress(): MediaScanProgress {
    return { ...this.progress }
  }

  cancel(): void {
    this.abort?.abort()
    this.abort = null
    this.progress = { ...this.progress, phase: 'idle' }
  }

  async scan(sourceId: string): Promise<MediaFile[]> {
    return this.run(sourceId, 'full')
  }

  async rescan(sourceId: string): Promise<MediaFile[]> {
    return this.run(sourceId, 'full')
  }

  async scanIncremental(sourceId: string): Promise<MediaFile[]> {
    return this.run(sourceId, 'incremental')
  }

  private async run(
    sourceId: string,
    _mode: 'full' | 'incremental',
  ): Promise<MediaFile[]> {
    this.cancel()
    const controller = new AbortController()
    this.abort = controller

    this.progress = {
      sourceId,
      phase: 'scanning',
      processed: 0,
      total: 0,
    }

    try {
      const files = await this.discover(
        sourceId,
        controller.signal,
        (processed, total) => {
          this.progress = {
            sourceId,
            phase: 'scanning',
            processed,
            total,
          }
        },
      )
      this.progress = {
        sourceId,
        phase: 'done',
        processed: files.length,
        total: files.length,
      }
      return files
    } catch (error) {
      if (controller.signal.aborted) {
        this.progress = { ...this.progress, phase: 'idle' }
        return []
      }
      this.progress = {
        ...this.progress,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Scan failed',
      }
      throw error
    } finally {
      if (this.abort === controller) {
        this.abort = null
      }
    }
  }
}
