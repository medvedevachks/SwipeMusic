/**
 * Мост Recommendation Engine → ContinuationProvider (search-seed runtime).
 */
import type { Track } from '../../types/track.ts'
import type {
  ContinuationCandidate,
  ContinuationProvider,
  ContinuationSignal,
} from '../continuation/types.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import { recommendNext } from './engine.ts'
import type { RecommendationCatalogPort, RecommendationMode } from './types.ts'

export type RecommendationContinuationDeps = {
  mode?: RecommendationMode
  loadProfile: () => Promise<UserTasteProfile | null>
  loadLibrary: (profile: UserTasteProfile | null) => Promise<readonly ContinuationLibraryTrack[]>
  createPort: () => Promise<RecommendationCatalogPort>
  excludedTracks?: () => readonly {
    id: string
    title: string
    artist: string
    sourceId?: string
    externalId?: string
  }[]
}

function abortFrom(signal: ContinuationSignal): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const sync = () => {
    if (signal.aborted) {
      controller.abort()
    }
  }
  sync()
  const timer = setInterval(sync, 40)
  return {
    signal: controller.signal,
    dispose: () => clearInterval(timer),
  }
}

export function createRecommendationContinuationProvider(
  deps: RecommendationContinuationDeps,
): ContinuationProvider {
  return {
    async prepareContinuation(
      current: Track,
      _context,
      signal,
    ): Promise<ContinuationCandidate | null> {
      if (signal.aborted) {
        return null
      }
      const gate = abortFrom(signal)
      try {
        const [profile, port] = await Promise.all([deps.loadProfile(), deps.createPort()])
        if (signal.aborted) {
          return null
        }
        const library = await deps.loadLibrary(profile)
        if (signal.aborted) {
          return null
        }
        const excluded = deps.excludedTracks?.() ?? [
          { id: current.id, title: current.title, artist: current.artist },
        ]
        const result = await recommendNext({
          mode: deps.mode ?? 'swipe',
          current,
          taste: profile,
          excluded,
          library,
          port,
          signal: gate.signal,
        })
        if (!result.ok) {
          return null
        }
        return { track: result.track }
      } catch {
        return null
      } finally {
        gate.dispose()
      }
    },
  }
}
