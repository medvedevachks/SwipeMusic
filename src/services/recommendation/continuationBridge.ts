/**
 * Мост Recommendation Engine → ContinuationProvider.
 * continuous-random-v1 + session pool + prefetch buffer.
 */
import type { Track } from '../../types/track.ts'
import type {
  ContinuationCandidate,
  ContinuationProvider,
  ContinuationSignal,
} from '../continuation/types.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import {
  beginContinuousBufferFill,
  CONTINUOUS_BUFFER_TARGET,
  getContinuousBufferGeneration,
  getContinuousBufferSize,
  pushContinuousBufferedTracks,
  setContinuousBufferRefillHandler,
  takeContinuousBufferedTrack,
} from './continuousBuffer.ts'
import { noteContinuousDiag } from './continuousDiag.ts'
import { collectContinuousPlayableBatch, pickContinuousRandom } from './continuousRandomV1.ts'
import {
  ensureContinuousDiscoverySession,
  getContinuousSeed,
  noteContinuousSeed,
} from './continuousSession.ts'
import { noteRecommendationMiss } from './sessionState.ts'
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

function scheduleBufferRefill(
  deps: RecommendationContinuationDeps,
  seed: Track,
  baseExcluded: readonly {
    id: string
    title: string
    artist: string
    sourceId?: string
    externalId?: string
  }[],
): void {
  beginContinuousBufferFill(async (generation) => {
    if (generation !== getContinuousBufferGeneration()) {
      return
    }
    const need = CONTINUOUS_BUFFER_TARGET - getContinuousBufferSize()
    if (need <= 0) {
      return
    }
    const [profile, port] = await Promise.all([deps.loadProfile(), deps.createPort()])
    if (generation !== getContinuousBufferGeneration()) {
      return
    }
    const library = await deps.loadLibrary(profile)
    if (generation !== getContinuousBufferGeneration()) {
      return
    }
    // Один discovery batch на весь buffer — не N× полный поиск.
    const batch = await collectContinuousPlayableBatch(
      {
        mode: deps.mode ?? 'swipe',
        current: seed,
        taste: profile,
        excluded: baseExcluded,
        library,
        port,
      },
      need,
    )
    if (generation !== getContinuousBufferGeneration()) {
      return
    }
    pushContinuousBufferedTracks(batch, {
      generation,
      excludeIds: new Set([seed.id, ...baseExcluded.map((item) => item.id).filter(Boolean)]),
    })
  })
}

export function createRecommendationContinuationProvider(
  deps: RecommendationContinuationDeps,
): ContinuationProvider {
  ensureContinuousDiscoverySession(deps.mode ?? 'swipe')

  setContinuousBufferRefillHandler((seed) => {
    const current = seed ?? getContinuousSeed()
    if (!current) {
      return
    }
    const excludedBase = deps.excludedTracks?.() ?? [
      { id: current.id, title: current.title, artist: current.artist },
    ]
    scheduleBufferRefill(deps, current, excludedBase)
  })

  return {
    async prepareContinuation(
      current: Track,
      _context,
      signal,
    ): Promise<ContinuationCandidate | null> {
      if (signal.aborted) {
        return null
      }

      ensureContinuousDiscoverySession(deps.mode ?? 'swipe')
      noteContinuousSeed(current)

      const excludedBase = deps.excludedTracks?.() ?? [
        { id: current.id, title: current.title, artist: current.artist },
      ]
      const excludeIds = new Set(
        [current.id, ...excludedBase.map((item) => item.id).filter((id): id is string => Boolean(id))],
      )

      const buffered = takeContinuousBufferedTrack(excludeIds)
      if (buffered) {
        noteContinuousSeed(buffered)
        scheduleBufferRefill(deps, buffered, [
          ...excludedBase,
          {
            id: buffered.id,
            title: buffered.title,
            artist: buffered.artist,
            sourceId: buffered.sourceId,
            externalId: buffered.externalId,
          },
        ])
        return { track: buffered }
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
        // Берём сразу несколько playable; первый — сейчас, остальные в buffer.
        const batch = await collectContinuousPlayableBatch(
          {
            mode: deps.mode ?? 'swipe',
            current,
            taste: profile,
            excluded: excludedBase,
            library,
            port,
            signal: gate.signal,
          },
          CONTINUOUS_BUFFER_TARGET,
        )
        if (batch.length === 0) {
          const result = await pickContinuousRandom({
            mode: deps.mode ?? 'swipe',
            current,
            taste: profile,
            excluded: excludedBase,
            library,
            port,
            signal: gate.signal,
          })
          if (!result.ok) {
            noteRecommendationMiss(result.emptyReason, result.message)
            noteContinuousDiag({
              mode: deps.mode ?? 'swipe',
              phase:
                result.emptyReason === 'timeout' || result.emptyReason === 'error'
                  ? 'soft-miss'
                  : 'hard-miss',
              reason: result.emptyReason,
            })
            return null
          }
          scheduleBufferRefill(deps, result.track, [
            ...excludedBase,
            {
              id: result.track.id,
              title: result.track.title,
              artist: result.track.artist,
              sourceId: result.track.sourceId,
              externalId: result.track.externalId,
            },
          ])
          return { track: result.track }
        }

        const [first, ...rest] = batch
        noteContinuousSeed(first!)
        pushContinuousBufferedTracks(rest, {
          generation: getContinuousBufferGeneration(),
          excludeIds: new Set([
            current.id,
            first!.id,
            ...excludedBase.map((item) => item.id).filter(Boolean),
          ]),
        })
        scheduleBufferRefill(deps, first!, [
          ...excludedBase,
          {
            id: first!.id,
            title: first!.title,
            artist: first!.artist,
            sourceId: first!.sourceId,
            externalId: first!.externalId,
          },
        ])
        return { track: first! }
      } catch {
        noteRecommendationMiss('error', 'Ошибка подбора. Можно повторить.')
        return null
      } finally {
        gate.dispose()
      }
    },
  }
}
