/**
 * TrackPreparePort поверх resolver infrastructure.
 * Не вызывает pause/stop/load физического плеера и не мутирует очередь.
 */
import type { PlaybackCandidate } from '../../playbackResolver/types.ts'
import type { Track } from '../../../types/track.ts'
import type {
  PreparedTrackHandle,
  TrackPreparePort,
  TrackPrepareRequest,
} from '../ports.ts'
import {
  createPreparedRef,
  type PreparedTrackCache,
} from './preparedTrackCache.ts'
import { sessionTrackAsTrack } from './sessionTrackAsTrack.ts'

export type ResolvePlaybackFn = (
  track: Track,
  signal: AbortSignal,
) => Promise<{
  url: string
  candidate: PlaybackCandidate | null
} | null>

export type ResolverTrackPreparePortOptions = {
  cache: PreparedTrackCache
  resolve: ResolvePlaybackFn
}

export function createResolverTrackPreparePort(
  options: ResolverTrackPreparePortOptions,
): TrackPreparePort & {
  getInFlightCount(): number
  abortAll(): void
} {
  const controllers = new Map<number, AbortController>()

  return {
    getInFlightCount() {
      return controllers.size
    },
    abortAll() {
      for (const ac of controllers.values()) {
        ac.abort()
      }
      controllers.clear()
    },
    async prepareTrack(
      request: TrackPrepareRequest,
    ): Promise<PreparedTrackHandle> {
      // Отменить устаревшие in-flight prepare
      for (const [id, ac] of controllers) {
        if (id < request.playRequestId) {
          ac.abort()
          controllers.delete(id)
        }
      }
      options.cache.dropOlderThan(request.playRequestId)

      const ac = new AbortController()
      controllers.set(request.playRequestId, ac)

      const track = sessionTrackAsTrack(request.track)

      try {
        const resolution = await options.resolve(track, ac.signal)
        if (ac.signal.aborted) {
          throw new Error('prepare cancelled')
        }
        if (!resolution?.url) {
          throw new Error('prepare: no available playback source')
        }

        const preparedRef = createPreparedRef(
          request.playRequestId,
          request.track.id,
        )
        options.cache.set(preparedRef, {
          track,
          url: resolution.url,
          candidate: resolution.candidate,
          playRequestId: request.playRequestId,
          createdAt: Date.now(),
        })

        return {
          trackId: request.track.id,
          preparedRef,
        }
      } finally {
        controllers.delete(request.playRequestId)
      }
    },
  }
}
