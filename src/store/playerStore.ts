import { create } from 'zustand'

type PlayerState = {
  currentTrackId: string | null
  setCurrentTrackId: (trackId: string | null) => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  currentTrackId: null,
  setCurrentTrackId: (trackId) => set({ currentTrackId: trackId }),
}))
