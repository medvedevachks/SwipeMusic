import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { getSearchSeedHardExclusions } from '../../types/playbackContext.ts'
import {
  createRecommendationContinuationProvider,
  type RecommendationCatalogPort,
} from '../recommendation/index.ts'
import { loadSessionTasteProfile } from '../taste/loadSessionTasteProfile.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { noteSearchFlowEvent } from './searchFlowDiag.ts'
import { getContinuationSession } from './ContinuationSession.ts'
import {
  mapCanonicalContinuationLibrary,
  type ContinuationLibraryTrack,
} from './libraryContinuation.ts'
import { setActiveRecommendationMode } from '../recommendation/sessionState.ts'
import { isSearchFlowHarnessEnabled } from './searchFlowHarnessFlag.ts'
import type { ContinuationProvider } from './types.ts'

let installed = false

export type SearchRecommendationRuntimeDeps = {
  /** Режим ядра: swipe и wave пока с одинаковой стратегией. */
  mode?: 'swipe' | 'wave'
  loadProfile?: () => Promise<UserTasteProfile | null>
  loadLibrary?: (profile: UserTasteProfile | null) => Promise<readonly ContinuationLibraryTrack[]>
  createPort?: () => Promise<RecommendationCatalogPort>
  excludedTracks?: () => readonly { id: string; title: string; artist: string }[]
}

async function loadCanonicalItems(): Promise<CanonicalLibraryItem[]> {
  const cached = Object.values(useCanonicalLibraryStore.getState().itemsById)
  if (cached.length > 0) {
    return cached
  }
  try {
    const response = await fetch('/api/me/canonical-library', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return []
    }
    const body = (await response.json()) as { items?: CanonicalLibraryItem[] }
    return Array.isArray(body.items) ? body.items : []
  } catch {
    return []
  }
}

function defaultExcludedTracks() {
  const queue = getPlaybackQueue()
  const fromQueue = queue.getItems().map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    sourceId: track.sourceId,
    externalId: track.externalId,
  }))
  // Hard exclude исходной поисковой выдачи (только search-seed context).
  const fromSearchHits = getSearchSeedHardExclusions(queue.getPlaybackContext())
  return [...fromQueue, ...fromSearchHits]
}

async function defaultCreatePort(): Promise<RecommendationCatalogPort> {
  // Lazy: SourceManager не нужен unit/integration-тестам с mock port.
  const { createLiveRadioPort } = await import('../personalRadio/livePort.ts')
  return createLiveRadioPort()
}

/**
 * Provider search-seed continuation на едином Recommendation Engine.
 * Harness оставляет свой provider (не перетираем).
 */
export function createSearchRecommendationProvider(
  deps: SearchRecommendationRuntimeDeps = {},
): ContinuationProvider {
  const inner = createRecommendationContinuationProvider({
    mode: deps.mode ?? 'swipe',
    loadProfile: deps.loadProfile ?? (() => loadSessionTasteProfile()),
    loadLibrary:
      deps.loadLibrary ??
      (async (profile) => {
        const items = await loadCanonicalItems()
        return mapCanonicalContinuationLibrary(items, profile)
      }),
    createPort: deps.createPort ?? defaultCreatePort,
    excludedTracks: deps.excludedTracks ?? defaultExcludedTracks,
  })

  return {
    async prepareContinuation(current, context, signal) {
      noteSearchFlowEvent({
        source: 'SearchRecommendation.prepare',
        trackId: current.id,
        detail: 'recommendation-engine',
        contextBefore: context.type,
      })
      const candidate = await inner.prepareContinuation(current, context, signal)
      noteSearchFlowEvent({
        source: 'SearchRecommendation.prepare→result',
        trackId: candidate?.track.id ?? null,
        nextSource: candidate ? 'continuation' : null,
        detail: candidate ? 'hit' : 'miss',
        contextAfter: context.type,
      })
      return candidate
    },
  }
}

/**
 * Ставит Recommendation Engine в ContinuationSession для search-seed.
 * Повторный вызов не переустанавливает provider (кроме force в тестах).
 */
export function ensureSearchRecommendation(options?: {
  force?: boolean
  deps?: SearchRecommendationRuntimeDeps
}): void {
  setActiveRecommendationMode('search')
  // Harness-сборка: provider ставит installSearchFlowHarness() до Play.
  if (isSearchFlowHarnessEnabled() && !options?.force) {
    installed = true
    return
  }
  if (installed && !options?.force) {
    return
  }
  installed = true
  getContinuationSession().setProvider(createSearchRecommendationProvider(options?.deps))
}

/** @deprecated имя для совместимости с PlaybackIntent; ставит Recommendation Engine. */
export function ensureLibraryContinuation(): void {
  ensureSearchRecommendation()
}

/** Сброс для тестов. */
export function resetSearchRecommendationRuntimeForTests(): void {
  installed = false
}
