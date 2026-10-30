/**
 * Production resolve для TrackPreparePort.
 * Подключается только когда feature flag ON (createSessionSwitchRuntime).
 */
import { getPlaybackResolver } from '../../playbackResolver'
import type { ResolvePlaybackFn } from './ResolverTrackPreparePort.ts'
import type { AudioPlayer } from '../../audioPlayer/AudioPlayer'

/**
 * Resolve через PlaybackResolver напрямую (без AudioPlayer.playResolved).
 * Не трогает физический плеер.
 */
export function createResolverResolveFn(): ResolvePlaybackFn {
  return async (track, signal) => {
    if (signal.aborted) {
      return null
    }
    const resolver = getPlaybackResolver()
    const resolution = await resolver.resolve(track)
    if (signal.aborted) {
      return null
    }
    if (!resolution?.url) {
      return null
    }
    return { url: resolution.url, candidate: resolution.candidate }
  }
}

/**
 * Resolve через AudioPlayer.resolveForSessionPrepare (тот же resolver, единый путь).
 */
export function createAudioPlayerResolveFn(
  player: AudioPlayer,
): ResolvePlaybackFn {
  return (track, signal) => player.resolveForSessionPrepare(track, signal)
}
