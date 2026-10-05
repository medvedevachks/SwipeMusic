import { clearCanonicalIdentityFlights } from '../canonical/userOrganization.ts'
import { resetPlaybackAvailability } from '../playbackAvailability/resetPlaybackAvailability.ts'
import { cancelActiveFallback } from '../runtimeFallback/fallbackControl.ts'
import { clearPlaybackFallbackUx } from '../../store/playbackFallbackUxStore.ts'
import { mapCanonicalLibrary } from '../canonical/mapCanonical.ts'
import { createDefaultCategories } from '../defaultCategories.ts'
import { getCollectionEngine } from '../collectionEngine/index.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { createBootstrapGate, executeLibraryBootstrap } from './bootstrapCore.ts'
import { libraryClient } from './client.ts'
import { mapLibraryState, type LibraryStateDto } from './mapLibraryState.ts'
import { handleLibraryFailure } from './mutations.ts'
import { useLibraryPersistenceStore } from './statusStore.ts'

const gate = createBootstrapGate()

function clearLocalLibrary(): void {
  cancelActiveFallback('logout')
  clearPlaybackFallbackUx()
  useLibraryPersistenceStore.getState().setArmed(false)
  useCollectionStore.getState().clearUserLibrary()
  getCollectionEngine().replaceStorageData({ tracks: [], actions: [] })
  useCanonicalLibraryStore.getState().clear()
  clearCanonicalIdentityFlights()
  resetPlaybackAvailability()
}

export function applyCanonicalSnapshot(
  userId: string,
  items: Parameters<typeof mapCanonicalLibrary>[0],
): void {
  useCanonicalLibraryStore.getState().replaceForUser(userId, mapCanonicalLibrary(items))
}

export function applyLibrarySnapshot(dto: LibraryStateDto): void {
  const hydrated = mapLibraryState(dto)
  useLibraryPersistenceStore.getState().setArmed(false)
  useCollectionStore.getState().applyServerState({
    categories: hydrated.categories,
    assignments: hydrated.assignments,
    likedTracks: hydrated.likedTracks,
    history: hydrated.history,
    gestureConfig: hydrated.gestureConfig,
  })
  getCollectionEngine().replaceStorageData({
    tracks: hydrated.tracks,
    actions: [],
  })
  useLibraryPersistenceStore.getState().setArmed(true)
}

export function resetLibrarySession(): void {
  gate.invalidate()
  clearLocalLibrary()
  useLibraryPersistenceStore.getState().setStatus('idle', null)
}

export function bootstrapLibrary(userId: string): Promise<void> {
  return gate.run(userId, async (isCurrent) => {
    clearLocalLibrary()
    useLibraryPersistenceStore.getState().setStatus('loading', null)
    try {
      const outcome = await executeLibraryBootstrap({
        isCurrent,
        createDefaults: createDefaultCategories,
        apply: (state) => {
          if (!isCurrent()) {
            return
          }
          applyLibrarySnapshot(state)
        },
        client: {
          load: () => libraryClient.loadState(),
          createCategory: (category) => libraryClient.createCategory(category),
        },
      })
      if (!isCurrent() || outcome === 'stale') {
        return
      }
      useCanonicalLibraryStore.getState().beginLoad()
      const canonical = await libraryClient.loadCanonicalLibrary()
      if (!isCurrent()) {
        return
      }
      applyCanonicalSnapshot(userId, canonical.items)
      useLibraryPersistenceStore.getState().setStatus('ready', null)
    } catch (error) {
      if (!isCurrent()) {
        return
      }
      handleLibraryFailure(error, 'load')
    }
  })
}
