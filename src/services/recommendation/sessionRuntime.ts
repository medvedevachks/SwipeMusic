/**
 * Единый runtime рекомендательных сессий: search / swipe / wave.
 * Живой путь не вызывает buildPersonalRadio.
 */
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { Track } from '../../types/track.ts'
import { getContinuationSession } from '../continuation/ContinuationSession.ts'
import {
  createSearchRecommendationProvider,
  type SearchRecommendationRuntimeDeps,
} from '../continuation/searchContinuationRuntime.ts'
import { noteSearchFlowEvent } from '../continuation/searchFlowDiag.ts'
import { mapCanonicalContinuationLibrary } from '../continuation/libraryContinuation.ts'
import { isSearchFlowHarnessEnabled } from '../continuation/searchFlowHarnessFlag.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { loadSessionTasteProfile } from '../taste/loadSessionTasteProfile.ts'
import { invalidateContinuousBuffer } from './continuousBuffer.ts'
import {
  clearContinuousDiscoveryRuntime,
  ensureContinuousDiscoverySession,
} from './continuousSession.ts'
import { recommendNext } from './engine.ts'
import {
  getRecommendationAdvanceEpoch,
  invalidateRecommendationAdvance,
  resetRecommendationAdvanceEpochForTests,
} from './advanceEpoch.ts'
import {
  clearRecommendationExhausted,
  getActiveRecommendationMode,
  setActiveRecommendationMode,
  type ActiveRecommendationMode,
} from './sessionState.ts'
import type { RecommendationCatalogPort, RecommendationMode, RecommendationResult } from './types.ts'

export type RecommendationSessionDeps = SearchRecommendationRuntimeDeps

export {
  getRecommendationAdvanceEpoch,
  invalidateRecommendationAdvance,
} from './advanceEpoch.ts'

let providerInstalled = false
let advanceChain: Promise<unknown> = Promise.resolve()

function toEngineMode(mode: ActiveRecommendationMode): RecommendationMode {
  return mode === 'search' ? 'swipe' : mode
}

async function defaultPort(): Promise<RecommendationCatalogPort> {
  const { createLiveRadioPort } = await import('../personalRadio/livePort.ts')
  return createLiveRadioPort()
}

async function defaultLibrary(
  profile: Awaited<ReturnType<typeof loadSessionTasteProfile>>,
) {
  const items = Object.values(useCanonicalLibraryStore.getState().itemsById)
  return mapCanonicalContinuationLibrary(items, profile)
}

/**
 * Активирует режим и ставит ContinuationProvider на Recommendation Engine.
 * Harness не перетирается без force.
 */
export function activateRecommendationSession(
  mode: ActiveRecommendationMode,
  options?: { forceProvider?: boolean; deps?: RecommendationSessionDeps },
): void {
  clearRecommendationExhausted()
  setActiveRecommendationMode(mode)
  ensureContinuousDiscoverySession(toEngineMode(mode))
  if (isSearchFlowHarnessEnabled() && !options?.forceProvider) {
    providerInstalled = true
    noteSearchFlowEvent({
      source: 'RecommendationSession.activate',
      detail: `mode=${mode};harness`,
    })
    return
  }
  if (providerInstalled && !options?.forceProvider && !options?.deps) {
    noteSearchFlowEvent({
      source: 'RecommendationSession.activate',
      detail: `mode=${mode};reuse-provider`,
    })
    return
  }
  providerInstalled = true
  getContinuationSession().setProvider(
    createSearchRecommendationProvider({
      mode: toEngineMode(mode),
      ...options?.deps,
    }),
  )
  noteSearchFlowEvent({
    source: 'RecommendationSession.activate',
    detail: `mode=${mode};provider-installed`,
  })
}

export function clearRecommendationSession(): void {
  clearRecommendationExhausted()
  setActiveRecommendationMode(null)
  // Inbox/Catalog поверх Wave/Search: inflight Next/ended не должен stop()/playTrack.
  invalidateRecommendationAdvance()
  invalidateContinuousBuffer('clear-session')
  clearContinuousDiscoveryRuntime('clear-session')
}

export function resetRecommendationSessionRuntimeForTests(): void {
  providerInstalled = false
  advanceChain = Promise.resolve()
  resetRecommendationAdvanceEpochForTests()
  setActiveRecommendationMode(null)
}

/**
 * Холодный старт: одна композиция из ядра.
 * Не пишет в очередь и не включает звук — это делает вызывающий код.
 */
export async function pickRecommendationStart(input: {
  mode: RecommendationMode
  deps?: RecommendationSessionDeps
}): Promise<RecommendationResult> {
  activateRecommendationSession(input.mode, {
    forceProvider: true,
    deps: input.deps,
  })
  const profile = (await (input.deps?.loadProfile ?? loadSessionTasteProfile)()) ?? null
  const library = await (input.deps?.loadLibrary ?? defaultLibrary)(profile)
  const port = await (input.deps?.createPort ?? defaultPort)()
  const result = await recommendNext({
    mode: input.mode,
    current: null,
    taste: profile,
    excluded: [],
    library,
    port,
  })
  noteSearchFlowEvent({
    source: 'RecommendationSession.pickStart',
    detail: result.ok ? result.reason : result.emptyReason,
    trackId: result.ok ? result.track.id : null,
    nextSource: result.ok ? 'continuation' : null,
  })
  return result
}

/** Пишет seed в очередь swipe/wave и готовит continuation. */
export function commitRecommendationSeed(input: {
  mode: Exclude<ActiveRecommendationMode, 'search'>
  track: Track
}): void {
  // Новый seed (wave/swipe) отменяет inflight advance предыдущей сессии.
  invalidateRecommendationAdvance()
  invalidateContinuousBuffer(`seed:${input.mode}`)
  ensureContinuousDiscoverySession(input.mode, { resetLanes: true })
  activateRecommendationSession(input.mode, { forceProvider: true })
  const queue = getPlaybackQueue()
  if (input.mode === 'wave') {
    queue.setQueue([input.track], 0, {
      type: 'radio',
      id: 'my-wave',
      title: 'Моя волна',
      origin: 'recommendations',
    })
  } else {
    queue.setQueue([input.track], 0, { type: 'swipe' })
  }
  getContinuationSession().prepare(input.track, {
    type: 'search-seed',
    query: input.mode === 'wave' ? 'my-wave' : 'swipe',
    seedTrackId: input.track.id,
  })
}

export function enqueueRecommendationAdvance<T>(run: () => Promise<T>): Promise<T> {
  const epoch = getRecommendationAdvanceEpoch()
  const next = advanceChain.then(
    () => {
      if (epoch !== getRecommendationAdvanceEpoch()) {
        return Promise.reject(new DOMException('Recommendation advance cancelled', 'AbortError'))
      }
      return run()
    },
    () => {
      if (epoch !== getRecommendationAdvanceEpoch()) {
        return Promise.reject(new DOMException('Recommendation advance cancelled', 'AbortError'))
      }
      return run()
    },
  )
  advanceChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function getRecommendationSessionMode(): ActiveRecommendationMode | null {
  return getActiveRecommendationMode()
}
