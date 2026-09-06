import { useSyncExternalStore } from 'react'
import {
  getPlaybackResolver,
  type PlaybackResolution,
} from '../services/playbackResolver'

function subscribe(onStoreChange: () => void): () => void {
  return getPlaybackResolver().subscribe(() => {
    onStoreChange()
  })
}

function getSnapshot(): PlaybackResolution | null {
  return getPlaybackResolver().getLastResolution()
}

/** Подписка на последний выбор PlaybackResolver (badge Preview и т.п.). */
export function usePlaybackResolution(): PlaybackResolution | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
