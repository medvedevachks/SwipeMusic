import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка Яндекс Музыки. */
export function createYandexMusicAdapter(): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: 'yandex-music',
    label: 'Яндекс Музыка',
    kind: 'official-api',
    capabilities: ['browse', 'search', 'library', 'recommendations', 'preview', 'auth'],
  })
}
