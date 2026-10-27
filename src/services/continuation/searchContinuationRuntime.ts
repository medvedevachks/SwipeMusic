import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { probeTrackPlayable } from '../personalRadio/livePort.ts'
import { loadSessionTasteProfile } from '../taste/loadSessionTasteProfile.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { getContinuationSession } from './ContinuationSession.ts'
import {
  createLibraryContinuationProvider,
  mapCanonicalContinuationLibrary,
  type ContinuationLibraryTrack,
} from './libraryContinuation.ts'

let installed = false

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

/**
 * Ставит библиотечное продолжение в уже существующую сессию.
 * Повторный вызов не отменяет текущую подготовку.
 */
export function ensureLibraryContinuation(): void {
  if (installed) {
    return
  }
  installed = true
  getContinuationSession().setProvider(
    createLibraryContinuationProvider({
      loadProfile: () => loadSessionTasteProfile(),
      loadLibrary: async (profile) => {
        const items = await loadCanonicalItems()
        return mapCanonicalContinuationLibrary(items, profile) satisfies ContinuationLibraryTrack[]
      },
      isPlayable: (track, signal) => probeTrackPlayable(track, signal),
      excludedTracks: () =>
        getPlaybackQueue().getItems().map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
        })),
    }),
  )
}
