import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { FetchTracksResult } from '../../types'

/**
 * Заготовка веб-источника (RSS, HTML-парсинг, публичные каталоги).
 */
export function createWebSourceAdapterStub(options?: {
  id?: string
  label?: string
}): MusicSourceAdapter {
  const id = options?.id ?? 'web'
  const label = options?.label ?? 'Web source'

  return {
    id,
    label,
    kind: 'web',
    capabilities: ['browse', 'search'],

    isAvailable() {
      return false
    },

    async fetchTracks(): Promise<FetchTracksResult> {
      throw new Error(`[${id}] Web source adapter is not configured yet`)
    },
  }
}
