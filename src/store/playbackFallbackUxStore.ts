import { create } from 'zustand'
import {
  emptyFallbackUx,
  type FallbackUxModel,
} from '../services/runtimeFallback/fallbackUxModel.ts'
import type { Track } from '../types/track.ts'

type PlaybackFallbackUxState = {
  model: FallbackUxModel
  requestedTrack: Track | null
  publish: (model: FallbackUxModel, requestedTrack?: Track | null) => void
  clear: () => void
}

export const usePlaybackFallbackUxStore = create<PlaybackFallbackUxState>((set) => ({
  model: emptyFallbackUx(),
  requestedTrack: null,
  publish: (model, requestedTrack) =>
    set({
      model,
      requestedTrack: requestedTrack === undefined ? null : requestedTrack,
    }),
  clear: () => set({ model: emptyFallbackUx(), requestedTrack: null }),
}))

export function clearPlaybackFallbackUx(): void {
  usePlaybackFallbackUxStore.getState().clear()
}
