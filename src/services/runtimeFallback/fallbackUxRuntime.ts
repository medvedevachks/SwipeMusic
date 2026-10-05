import { sourceTrackKeyOf } from '../canonical/mapCanonical.ts'
import { canonicalItemForTrack } from '../canonical/selectors.ts'
import { findCollectionPlaybackTrack } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { clearPlaybackFallbackUx, usePlaybackFallbackUxStore } from '../../store/playbackFallbackUxStore.ts'
import type { PlaybackAvailabilityStatus } from '../../types/playbackAvailability.ts'
import type { Track } from '../../types/track.ts'
import { getSourceDisplayName } from '../../utils/sourceDisplay.ts'
import { cancelActiveFallback } from './fallbackControl.ts'
import { bindFallbackUxLabels, bindPlayerErrorCleaner } from './fallbackUxPublish.ts'
import {
  buildManualAlternatives,
  withRecheckedStatus,
} from './fallbackUxModel.ts'
import { confirmLiveFallback } from './livePlayback.ts'

let labelsBound = false

export function ensureFallbackUxBindings(): void {
  if (labelsBound) {
    return
  }
  labelsBound = true
  bindFallbackUxLabels(getSourceDisplayName)
  bindPlayerErrorCleaner(() => {
    void import('../audioPlayer/index.ts').then(({ getAudioPlayer }) => {
      getAudioPlayer().clearOwnedPlaybackError()
    })
  })
}

export async function confirmFallbackPlayback(): Promise<void> {
  await confirmLiveFallback()
}

export function dismissFallbackPrompt(kind: 'confirmation' | 'notice' | 'terminal' | 'idle'): void {
  if (kind === 'confirmation') {
    cancelActiveFallback('manual-play')
    return
  }
  clearPlaybackFallbackUx()
}

export async function retryFallbackPlayback(): Promise<void> {
  const track = usePlaybackFallbackUxStore.getState().requestedTrack
  clearPlaybackFallbackUx()
  if (!track) {
    return
  }
  const { getAudioPlayer } = await import('../audioPlayer/index.ts')
  await getAudioPlayer().playTrack(track)
}

export async function playAlternativeCopy(sourceTrackKey: string): Promise<void> {
  const track = findPlayableTrack(sourceTrackKey)
  cancelActiveFallback('manual-play')
  if (!track) {
    return
  }
  const { getAudioPlayer } = await import('../audioPlayer/index.ts')
  await getAudioPlayer().playTrack(track, { preserveQueue: true })
}

export async function openManualSourceAlternatives(track: Track): Promise<void> {
  ensureFallbackUxBindings()
  const item = canonicalItemForTrack(useCanonicalLibraryStore.getState(), track)
  if (!item || item.copies.length < 2) {
    return
  }
  const availability = await resolveAvailability(item.canonicalTrack.id, item.copies)
  if (!availability) {
    return
  }
  usePlaybackFallbackUxStore.getState().publish(
    buildManualAlternatives({
      canonicalTrackId: item.canonicalTrack.id,
      copies: item.copies,
      availability,
      labelOf: getSourceDisplayName,
    }),
    track,
  )
}

export async function recheckFallbackCopy(sourceId: string, sourceTrackKey: string): Promise<void> {
  const { invalidatePlaybackAvailabilityBySource } = await import('../playbackAvailability/cache.ts')
  invalidatePlaybackAvailabilityBySource(sourceId)
  const state = usePlaybackFallbackUxStore.getState()
  const track = state.requestedTrack
  const canonicalTrackId = state.model.canonicalTrackId
  if (!track || !canonicalTrackId) {
    return
  }
  const item = canonicalItemForTrack(useCanonicalLibraryStore.getState(), track)
  if (!item) {
    return
  }
  const availability = await resolveAvailability(item.canonicalTrack.id, item.copies)
  const status: PlaybackAvailabilityStatus | null =
    availability?.copies.find((copy) => copy.sourceTrackKey === sourceTrackKey)?.status ?? null
  if (!status) {
    return
  }
  state.publish(withRecheckedStatus(state.model, sourceTrackKey, status, getSourceDisplayName), track)
}

function findPlayableTrack(sourceTrackKey: string): Track | null {
  const requested = usePlaybackFallbackUxStore.getState().requestedTrack
  if (requested && sourceTrackKeyOf(requested) === sourceTrackKey) {
    return requested
  }
  return findCollectionPlaybackTrack(sourceTrackKey)
}

async function resolveAvailability(
  canonicalTrackId: string,
  copies: Parameters<typeof buildManualAlternatives>[0]['copies'],
) {
  try {
    const [availability, registry] = await Promise.all([
      import('../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'),
      import('../playbackAvailability/registryPort.ts'),
    ])
    return await availability.resolveCanonicalPlaybackAvailability(
      { canonicalTrackId, copies },
      { port: registry.createSourceRegistryAvailabilityPort() },
    )
  } catch {
    return null
  }
}
