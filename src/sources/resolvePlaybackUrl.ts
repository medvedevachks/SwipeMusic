import type { Track } from '../types/track'
import { sourceRegistry } from './registry'
import { sourceManager } from './SourceManager'

/**
 * Актуальный URL для плеера: через MusicSourceAdapter.getStream,
 * чтобы blob: URL локальных файлов не устаревали после revoke.
 */
export async function resolvePlaybackUrl(track: Track): Promise<string | null> {
  // listSources() гарантирует bootstrap SourceManager / registry.
  sourceManager.listSources()

  if (sourceRegistry.has(track.sourceId)) {
    try {
      const adapter = sourceRegistry.get(track.sourceId)
      if (adapter.supportsStreaming) {
        const url = await adapter.getStream(track)
        if (url) {
          return url
        }
      }
    } catch {
      // fallback ниже
    }
  }

  return track.previewUrl ?? null
}
