import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { FetchTracksResult } from '../../types'

/**
 * Заготовка адаптера официального API (Spotify и аналоги).
 * Зарегистрировать в registry после реализации auth + API-клиента.
 */
export function createOfficialApiAdapterStub(options: {
  id: string
  label: string
}): MusicSourceAdapter {
  return {
    id: options.id,
    label: options.label,
    kind: 'official-api',
    capabilities: ['browse', 'search', 'library', 'recommendations', 'preview', 'auth'],
    connectionNote: 'Официальный API не настроен.',

    isAvailable() {
      return false
    },

    async fetchTracks(): Promise<FetchTracksResult> {
      throw new Error(
        `[${options.id}] Official API adapter is not configured yet`,
      )
    },

    async search(): Promise<FetchTracksResult> {
      throw new Error(`[${options.id}] Search is not configured yet`)
    },

    canPlay() {
      return false
    },
  }
}
