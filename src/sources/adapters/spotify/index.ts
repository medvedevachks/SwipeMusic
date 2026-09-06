import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка Spotify Web API / Playback. */
export function createSpotifyAdapter(): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: 'spotify',
    label: 'Spotify',
    kind: 'official-api',
    capabilities: ['browse', 'search', 'library', 'recommendations', 'preview', 'auth'],
  })
}
