import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/**
 * @deprecated Используйте createSpotifyAdapter / createYandexMusicAdapter.
 */
export function createOfficialApiAdapterStub(options: {
  id: string
  label: string
}): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: options.id,
    label: options.label,
    kind: 'official-api',
    capabilities: [
      'browse',
      'search',
      'library',
      'recommendations',
      'preview',
      'auth',
    ],
  })
}
