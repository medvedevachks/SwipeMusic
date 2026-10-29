import type { SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { bootstrapMusicSources, sourceRegistry } from '../../sources/index.ts'

function trackMatchesCopy(track: Track, copy: SourceCopy): boolean {
  if (track.sourceId !== copy.sourceId || track.externalId !== copy.externalId) {
    return false
  }
  return (
    track.id === copy.sourceTrackKey ||
    `${track.sourceId}:${track.externalId}` === copy.sourceTrackKey
  )
}

/**
 * Официальный путь адаптера: getTrack по sourceTrackKey / externalId.
 * Не создаёт SourceCopy и не подставляет URL.
 * Чужой identity отбрасывается.
 */
export async function resolveMissingCatalogTrack(
  copy: SourceCopy,
): Promise<Track | null> {
  bootstrapMusicSources()
  if (!sourceRegistry.has(copy.sourceId)) {
    return null
  }
  const adapter = sourceRegistry.get(copy.sourceId)
  if (typeof adapter.getTrack !== 'function') {
    return null
  }

  try {
    if (!(await Promise.resolve(adapter.isAvailable()))) {
      return null
    }
  } catch {
    return null
  }

  try {
    const byKey = await adapter.getTrack(copy.sourceTrackKey)
    if (byKey && trackMatchesCopy(byKey, copy)) {
      return byKey
    }
    const byExternal = await adapter.getTrack(copy.externalId)
    if (byExternal && trackMatchesCopy(byExternal, copy)) {
      return byExternal
    }
    return null
  } catch {
    return null
  }
}
