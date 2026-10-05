import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import { PLAYBACK_AVAILABILITY_REASON, PLAYBACK_AVAILABILITY_STATUS } from '../../../types/playbackAvailability.ts'
import type { FetchTracksResult } from '../../types'
import { homeSections } from '../../../services/mockTracks.ts'
import { createTrack } from '../../normalizeTrack.ts'
import type { Track } from '../../../types/track'

const SOURCE_ID = 'mock'

export function createMockMusicSourceAdapter(): MusicSourceAdapter {
  let cache: Track[] | null = null

  const loadAll = (): Track[] => {
    if (cache) {
      return cache
    }

    cache = homeSections.flatMap((section) =>
      section.tracks.map((track, index) =>
        createTrack({
          sourceId: SOURCE_ID,
          externalId: track.id,
          title: track.title,
          artist: track.artist,
          coverColor: track.coverColor,
          previewUrl: track.previewUrl ?? null,
          album: section.title,
          durationMs: 180_000 + index * 1_000,
        }),
      ),
    )

    return cache
  }

  return {
    id: SOURCE_ID,
    label: 'Demo library',
    type: 'api',
    kind: 'mock',
    capabilities: ['browse', 'recommendations', 'search'],
    supportsSearch: true,
    supportsStreaming: true,
    supportsPagination: false,

    async initialize() {},

    isAvailable() {
      return true
    },

    async fetchTracks(params = {}): Promise<FetchTracksResult> {
      const all = loadAll()
      const limit = params.limit ?? all.length
      return {
        tracks: all.slice(0, limit),
        nextCursor: null,
      }
    },

    async search(query, params = {}) {
      const normalized = query.trim().toLowerCase()
      const all = loadAll().filter(
        (track) =>
          track.title.toLowerCase().includes(normalized) ||
          track.artist.toLowerCase().includes(normalized),
      )
      const limit = params.limit ?? all.length
      return {
        tracks: all.slice(0, limit),
        nextCursor: null,
      }
    },

    async getTrack(trackId) {
      return (
        loadAll().find(
          (track) => track.id === trackId || track.externalId === trackId,
        ) ?? null
      )
    },

    async getStream(track) {
      if (track.previewUrl) {
        return track.previewUrl
      }
      throw new Error('[mock] Track has no preview URL')
    },

    async getPlaybackCandidates(track) {
      const url = track.previewUrl ?? null
      return [
        {
          id: 'mock:stream',
          providerId: SOURCE_ID,
          type: 'stream',
          priority: 0,
          available: Boolean(url),
          url,
          label: 'Demo stream',
          reason: url ? undefined : 'No demo URL',
        },
        {
          id: 'mock:preview',
          providerId: SOURCE_ID,
          type: 'preview',
          priority: 0,
          available: Boolean(url),
          url,
          label: 'Demo preview',
          reason: url ? undefined : 'No demo URL',
        },
      ]
    },

    async checkTrackAvailability(track) {
      const known = loadAll().find(
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

    async getCover(track) {
      return track.coverUrl ?? undefined
    },

    async dispose() {
      cache = null
    },
  }
}
