import { create } from 'zustand'
import type { CanonicalPlaybackAvailability } from '../types/playbackAvailability.ts'

type PlaybackAvailabilityStore = {
  byCanonicalId: Record<string, CanonicalPlaybackAvailability>
  replace: (result: CanonicalPlaybackAvailability) => void
  clear: () => void
}

export const usePlaybackAvailabilityStore = create<PlaybackAvailabilityStore>((set) => ({
  byCanonicalId: {},
  replace: (result) =>
    set((state) => ({
      byCanonicalId: {
        ...state.byCanonicalId,
        [result.canonicalTrackId]: result,
      },
    })),
  clear: () => set({ byCanonicalId: {} }),
}))
