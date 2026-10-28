import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
} from '../../../types/playbackAvailability.ts'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter.ts'
import type { FetchTracksResult } from '../../types.ts'
import {
  buildDevAcceptanceCatalog,
  DEV_ACCEPTANCE_SOURCE_ID,
} from './catalog.ts'

export function createDevAcceptanceAdapter(): MusicSourceAdapter {
  const catalog = buildDevAcceptanceCatalog()

  return {
    id: DEV_ACCEPTANCE_SOURCE_ID,
    label: 'DEV Acceptance Catalog',
    type: 'api',
    kind: 'mock',
    capabilities: ['browse', 'search', 'recommendations'],
    supportsSearch: true,
    supportsStreaming: true,
    supportsPagination: false,

    async initialize() {},

    isAvailable() {
      return true
    },

    async fetchTracks(params = {}): Promise<FetchTracksResult> {
      const limit = params.limit ?? catalog.length
      return { tracks: catalog.slice(0, limit), nextCursor: null }
    },

    async search(query, params = {}) {
      const needle = query.trim().toLowerCase()
      const hits = catalog.filter(
        (track) =>
          track.title.toLowerCase().includes(needle) ||
          track.artist.toLowerCase().includes(needle),
      )
      const limit = params.limit ?? hits.length
      return { tracks: hits.slice(0, limit), nextCursor: null }
    },

    async getTrack(trackId) {
      return (
        catalog.find((track) => track.id === trackId || track.externalId === trackId) ??
        null
      )
    },

    async getStream(track) {
      const known = catalog.find(
        (item) => item.id === track.id || item.externalId === track.externalId,
      )
      const url = track.previewUrl ?? known?.previewUrl ?? null
      if (url) {
        return url
      }
      throw new Error('[dev-acceptance] Track has no preview URL')
    },

    async getPlaybackCandidates(track) {
      const known = catalog.find(
        (item) => item.id === track.id || item.externalId === track.externalId,
      )
      const url = track.previewUrl ?? known?.previewUrl ?? null
      return [
        {
          id: `${DEV_ACCEPTANCE_SOURCE_ID}:stream`,
          providerId: DEV_ACCEPTANCE_SOURCE_ID,
          type: 'stream',
          priority: 0,
          available: Boolean(url),
          url,
          label: 'DEV acceptance stream',
          reason: url ? undefined : 'No stream URL',
        },
      ]
    },

    async checkTrackAvailability(track) {
      const known = catalog.find(
        (item) => item.id === track.id || item.externalId === track.externalId,
      )
      if (track.previewUrl || known?.previewUrl) {
        return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
      }
      return {
        status: PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
        reason: PLAYBACK_AVAILABILITY_REASON.TRACK_MISSING,
      }
    },

    async getCover() {
      return undefined
    },

    async dispose() {},
  }
}
