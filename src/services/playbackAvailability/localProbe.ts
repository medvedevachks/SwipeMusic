import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
  type TrackAvailabilityProbe,
} from '../../types/playbackAvailability.ts'

export type LocalAccessSnapshot = {
  accessState: 'unsupported' | 'idle' | 'granted' | 'prompt' | 'denied'
  hasDirectoryHandle: boolean
  hasFileHandle: boolean
  /** Временный File из FileList в памяти сессии — без directory handle. */
  hasSessionFile?: boolean
}

/** Та же проверка, что вызывает Local adapter. Наличие SourceCopy само по себе не делает файл playable. */
export function assessLocalFileAvailability(
  snapshot: LocalAccessSnapshot,
): TrackAvailabilityProbe {
  if (snapshot.accessState === 'unsupported') {
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
      reason: PLAYBACK_AVAILABILITY_REASON.PLAYBACK_UNSUPPORTED,
    }
  }
  if (snapshot.accessState !== 'granted') {
    return {
      status: PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      reason: PLAYBACK_AVAILABILITY_REASON.LOCAL_HANDLE_MISSING,
    }
  }
  if (snapshot.hasSessionFile) {
    return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
  }
  if (snapshot.hasDirectoryHandle && snapshot.hasFileHandle) {
    return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
  }
  return {
    status: PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
    reason: PLAYBACK_AVAILABILITY_REASON.LOCAL_HANDLE_MISSING,
  }
}
