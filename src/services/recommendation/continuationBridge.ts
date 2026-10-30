/**
 * Мост Recommendation Engine → ContinuationProvider.
 * continuous-random-v1 для swipe/wave; legacy для search.
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
  beginContinuousDiscoveryOperation,
  ensureContinuousDiscoverySession,
  getContinuousSeed,
  isContinuousDiscoveryOperationCurrent,
  noteContinuousSeed,
} from './continuousSession.ts'
import { recommendNextLegacy } from './engine.ts'
import { noteRecommendationMiss } from './sessionState.ts'
import type {
  RecommendationCatalogPort,
  RecommendationMode,
  RecommendationStrategy,
} from './types.ts'

export type RecommendationContinuationDeps = {
  mode?: RecommendationMode
  /** По умолчанию continuous-random; search обязан передать legacy. */
  strategy?: RecommendationStrategy
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
  if ((deps.strategy ?? 'continuous-random') === 'legacy') {
    return
  }
  const discoveryOp = beginContinuousDiscoveryOperation()
  beginContinuousBufferFill(async (generation) => {
    if (generation !== getContinuousBufferGeneration()) {
      return
    }
    if (!isContinuousDiscoveryOperationCurrent(discoveryOp)) {
      return
    }
    const need = CONTINUOUS_BUFFER_TARGET - getContinuousBufferSize()
    if (need <= 0) {
      return
    }
    const [profile, port] = await Promise.all([deps.loadProfile(), deps.createPort()])
    if (
      generation !== getContinuousBufferGeneration() ||
      !isContinuousDiscoveryOperationCurrent(discoveryOp)
    ) {
      return
    }
    const library = await deps.loadLibrary(profile)
    if (
      generation !== getContinuousBufferGeneration() ||
      !isContinuousDiscoveryOperationCurrent(discoveryOp)
    ) {
      return
    }
    const batch = await collectContinuousPlayableBatch(
      {
        mode: deps.mode ?? 'swipe',
        current: seed,
        taste: profile,
        excluded: baseExcluded,
        library,
        port,
        strategy: 'continuous-random',
      },
      need,
    )
    if (
      generation !== getContinuousBufferGeneration() ||
      !isContinuousDiscoveryOperationCurrent(discoveryOp)
    ) {
      return
    }
    pushContinuousBufferedTracks(batch, {
      generation,
      excludeIds: new Set([seed.id, ...baseExcluded.map((item) => item.id).filter(Boolean)]),
    })
  })
}

async function prepareLegacyContinuation(
  deps: RecommendationContinuationDeps,
  current: Track,
  signal: ContinuationSignal,
): Promise<ContinuationCandidate | null> {
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
    const excludedBase = deps.excludedTracks?.() ?? [
      { id: current.id, title: current.title, artist: current.artist },
    ]
    const result = await recommendNextLegacy({
      mode: deps.mode ?? 'swipe',
      current,
      taste: profile,
      excluded: excludedBase,
      library,
      port,
      signal: gate.signal,
      strategy: 'legacy',
    })
    if (!result.ok) {
      noteRecommendationMiss(result.emptyReason, result.message)
      noteContinuousDiag({
        mode: deps.mode ?? 'swipe',
        phase:
          result.emptyReason === 'timeout' || result.emptyReason === 'error'
            ? 'soft-miss'
            : 'hard-miss',
        reason: `legacy:${result.emptyReason}`,
      })
      return null
    }
    return { track: result.track }
  } catch {
    noteRecommendationMiss('error', 'Ошибка подбора. Можно повторить.')
    return null
  } finally {
    gate.dispose()
  }
}

export function createRecommendationContinuationProvider(
  deps: RecommendationContinuationDeps,
): ContinuationProvider {
  const strategy = deps.strategy ?? 'continuous-random'
  if (strategy === 'continuous-random') {
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
  } else {
    setContinuousBufferRefillHandler(null)
  }

  return {
    async prepareContinuation(
      current: Track,
      _context,
      signal,
    ): Promise<ContinuationCandidate | null> {
      if (signal.aborted) {
        return null
      }

      if (strategy === 'legacy') {
        return prepareLegacyContinuation(deps, current, signal)
      }

      ensureContinuousDiscoverySession(deps.mode ?? 'swipe')
      const discoveryOp = beginContinuousDiscoveryOperation()
      noteContinuousSeed(current)

      const excludedBase = deps.excludedTracks?.() ?? [
        { id: current.id, title: current.title, artist: current.artist },
      ]
      const excludeIds = new Set(
        [current.id, ...excludedBase.map((item) => item.id).filter((id): id is string => Boolean(id))],
      )

      const buffered = takeContinuousBufferedTrack(excludeIds)
      if (buffered) {
        if (!isContinuousDiscoveryOperationCurrent(discoveryOp)) {
          return null
        }
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
        if (signal.aborted || !isContinuousDiscoveryOperationCurrent(discoveryOp)) {
          return null
        }
        const library = await deps.loadLibrary(profile)
        if (signal.aborted || !isContinuousDiscoveryOperationCurrent(discoveryOp)) {
          return null
        }
        const batch = await collectContinuousPlayableBatch(
          {
            mode: deps.mode ?? 'swipe',
            current,
            taste: profile,
            excluded: excludedBase,
            library,
            port,
            signal: gate.signal,
            strategy: 'continuous-random',
          },
          CONTINUOUS_BUFFER_TARGET,
        )
        if (!isContinuousDiscoveryOperationCurrent(discoveryOp)) {
          return null
        }
        if (batch.length === 0) {
          const result = await pickContinuousRandom({
            mode: deps.mode ?? 'swipe',
            current,
            taste: profile,
            excluded: excludedBase,
            library,
            port,
            signal: gate.signal,
            strategy: 'continuous-random',
          })
          if (!isContinuousDiscoveryOperationCurrent(discoveryOp)) {
            return null
          }
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
