import { usePlaybackAvailabilityStore } from '../../store/playbackAvailabilityStore.ts'
import { clearPlaybackAvailabilityCache } from './cache.ts'

/** Logout и смена пользователя. Кэш не переживает сессию. */
export function resetPlaybackAvailability(): void {
  clearPlaybackAvailabilityCache()
  usePlaybackAvailabilityStore.getState().clear()
}
