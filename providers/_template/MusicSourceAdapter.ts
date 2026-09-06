import type { MusicSourceAdapter } from '../../src/sources/MusicSourceAdapter'
import type { ProviderContext } from '../../src/sdk'
import { createTrack } from '../../src/sources/normalizeTrack'

/**
 * Минимальный MusicSourceAdapter для шаблона.
 * Замените fetchTracks / search / getStream на реальную логику.
 */
export function createMyProviderAdapter(
  ctx: ProviderContext,
): MusicSourceAdapter {
  ctx.logger.info('MyProvider adapter created')

  return {
    id: 'my-provider',
    label: 'My Provider',
    type: 'api',
    kind: 'official-api',
    capabilities: ['browse', 'search'],
    supportsSearch: true,
    supportsStreaming: true,
    supportsPagination: false,

    async initialize() {},

    isAvailable() {
      return true
    },

    async fetchTracks() {
      // Пример: ctx.http.getJson('/tracks')
      return {
        tracks: [
          createTrack({
            sourceId: 'my-provider',
            externalId: 'demo-1',
            title: 'Demo Track',
            artist: 'My Provider',
            previewUrl: null,
          }),
        ],
        nextCursor: null,
      }
    },

    async search(query) {
      const result = await this.fetchTracks()
      const q = query.trim().toLowerCase()
      return {
        tracks: result.tracks.filter((track) =>
          `${track.title} ${track.artist}`.toLowerCase().includes(q),
        ),
        nextCursor: null,
      }
    },

    async getTrack(trackId) {
      const result = await this.fetchTracks()
      return result.tracks.find((track) => track.id === trackId) ?? null
    },

    async getStream(track) {
      if (track.previewUrl) {
        return track.previewUrl
      }
      throw new Error('No stream URL')
    },

    async getCover() {
      return undefined
    },

    dispose() {},
  }
}
