import { getAudioPlayer } from '../audioPlayer/index.ts'
import { getPlaybackIntent } from '../playbackIntent/PlaybackIntent.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { MY_WAVE_ID, type RadioLibraryItem } from './recommend.ts'
import { createLiveRadioPort } from './livePort.ts'
import { getRadioSelection } from './radioSelection.ts'
import { loadSessionTasteProfile } from '../taste/loadSessionTasteProfile.ts'
import { toggleMyWave, type MyWaveDeps } from './toggleMyWave.ts'

const ROTATION_KEY = 'swipe-music.my-wave.rotation'

function libraryItem(item: CanonicalLibraryItem): RadioLibraryItem {
  return {
    canonicalId: item.canonicalTrack.id,
    title: item.canonicalTrack.title,
    artist: item.canonicalTrack.artist,
    liked: item.state.liked,
    disliked: item.state.disliked,
    hidden: item.state.hidden,
    playCount: item.state.playCount,
    skipped: item.state.skipped,
    lastPlayed: item.state.lastPlayed,
    copies: item.copies.map((copy) => ({
      sourceId: copy.sourceId,
      externalId: copy.externalId,
      title: copy.title,
      artist: copy.artist,
    })),
  }
}

function readRotation(): number {
  try {
    const raw = sessionStorage.getItem(ROTATION_KEY)
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

function storeRotation(value: number): void {
  try {
    sessionStorage.setItem(ROTATION_KEY, String(value))
  } catch {
    // Приватный режим не мешает текущему запуску.
  }
}

export function createDefaultMyWaveDeps(): MyWaveDeps {
  return {
    readTransport: () => {
      const player = getAudioPlayer().getState()
      const queue = getPlaybackQueue()
      const context = queue.getPlaybackContext()
      return {
        radioActive: context.type === 'radio' && context.id === MY_WAVE_ID,
        playing: player.playing,
        paused: player.paused,
        queueLength: queue.getItems().length,
      }
    },
    pause: () => {
      getAudioPlayer().pause()
    },
    resume: () => getAudioPlayer().resume(),
    play: async (plan) => {
      if (!plan.origin) {
        return
      }
      await getPlaybackIntent().playRadio({
        tracks: plan.tracks,
        startIndex: plan.startIndex,
        origin: plan.origin,
      })
    },
    loadLibrary: () =>
      Object.values(useCanonicalLibraryStore.getState().itemsById).map(libraryItem),
    loadPort: createLiveRadioPort,
    readRotation,
    storeRotation,
  }
}

export function toggleLiveMyWave() {
  const selection = getRadioSelection()
  return toggleMyWave({
    ...createDefaultMyWaveDeps(),
    ...(selection === 'taste'
      ? { selection, loadTasteProfile: loadSessionTasteProfile }
      : {}),
  })
}
