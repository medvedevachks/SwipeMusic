import { createUnimplementedSourceAdapter } from '../createUnimplementedSourceAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка парсера Zaycev.net. */
export function createZaycevAdapter(): MusicSourceAdapter {
  return createUnimplementedSourceAdapter({
    id: 'zaycev',
    label: 'Zaycev.net',
    kind: 'web',
    capabilities: ['browse', 'search'],
  })
}
