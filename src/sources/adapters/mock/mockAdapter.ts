import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { FetchTracksResult } from '../../types'
import { homeSections } from '../../../services/mockTracks'
import { createTrack } from '../../normalizeTrack'

const SOURCE_ID = 'mock'

export function createMockMusicSourceAdapter(): MusicSourceAdapter {
  return {
    id: SOURCE_ID,
    label: 'Demo library',
    kind: 'mock',
    capabilities: ['browse', 'recommendations'],
    connectionNote: 'Демо-лента для свайпов. Это не внешний музыкальный сервис.',

    isAvailable() {
      return true
    },

    async fetchTracks(params = {}): Promise<FetchTracksResult> {
      const all = homeSections.flatMap((section) =>
        section.tracks.map((track, index) =>
          createTrack({
            sourceId: SOURCE_ID,
            externalId: track.id,
            title: track.title,
            artist: track.artist,
            coverColor: track.coverColor,
            // сохраняем порядок секций как «рекомендации»
            album: section.title,
            durationMs: 180_000 + index * 1_000,
          }),
        ),
      )

      const limit = params.limit ?? all.length
      return {
        tracks: all.slice(0, limit),
        nextCursor: null,
      }
    },

    canPlay() {
      return false
    },
  }
}
