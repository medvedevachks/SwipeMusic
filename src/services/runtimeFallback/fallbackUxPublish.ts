import { clearPlaybackFallbackUx, usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore.ts'
import type { RuntimeFallbackResult } from '../../types/runtimeFallback.ts'
import type { Track } from '../../types/track.ts'
import { buildFallbackUx, type ProviderLabelLookup } from './fallbackUxModel.ts'

let labelOf: ProviderLabelLookup = (sourceId) => sourceId
let clearPlayerError: (() => void) | null = null

export function bindFallbackUxLabels(lookup: ProviderLabelLookup): void {
  labelOf = lookup
}

export function bindPlayerErrorCleaner(cleaner: () => void): void {
  clearPlayerError = cleaner
}

export function publishFallbackResult(
  result: RuntimeFallbackResult | null,
  generation: number | null,
  requestedTrack: Track | null = null,
): void {
  if (!result) {
    return
  }
  const model = buildFallbackUx(result, labelOf, generation)
  usePlaybackFallbackUxStore.getState().publish(model, requestedTrack)
  if (model.ownsPlayerError) {
    clearPlayerError?.()
  }
}

export function dismissFallbackUx(): void {
  clearPlaybackFallbackUx()
}
