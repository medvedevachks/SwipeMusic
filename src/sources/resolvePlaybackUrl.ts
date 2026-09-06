import type { Track } from '../types/track'
import { getPlaybackResolver } from '../services/playbackResolver'
import { sourceManager } from './SourceManager'

/**
 * Актуальный URL для плеера через PlaybackResolver.
 * Сохранено для обратной совместимости; предпочтительно AudioPlayer.playTrack.
 */
export async function resolvePlaybackUrl(track: Track): Promise<string | null> {
  sourceManager.listSources()
  const resolution = await getPlaybackResolver().resolve(track)
  return resolution?.url ?? null
}
