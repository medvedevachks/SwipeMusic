import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка VK Музыки. */
export function createVKMusicAdapter(): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: 'vk-music',
    label: 'VK Музыка',
    kind: 'official-api',
    capabilities: ['browse', 'search', 'library', 'auth'],
  })
}
