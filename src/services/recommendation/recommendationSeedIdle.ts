/**
 * Idle-guard для cold seed (PLAYBACK-CME-01).
 * Не даёт фоновому swipe seed перезаписать живую SEARCH/CATALOG/ALBUM/WAVE сессию.
 */
import { isQueueLockedContext } from '../../types/playbackContext.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { isSessionSwitchIntegrationEnabled } from '../sessionSwitch/featureFlag.ts'
import { getSessionSwitchAppRuntime } from '../sessionSwitch/integration/sessionSwitchAppRuntime.ts'

export function isRecommendationSeedIdle(): boolean {
  const snap = getPlaybackQueue().getSnapshot()
  if (snap.items.length > 0) {
    return false
  }
  if (isQueueLockedContext(snap.context)) {
    return false
  }
  if (!isSessionSwitchIntegrationEnabled()) {
    return true
  }
  const active = getSessionSwitchAppRuntime()?.store.getActiveSessionId()
  if (
    active === 'search' ||
    active === 'catalog' ||
    active === 'album' ||
    active === 'wave'
  ) {
    return false
  }
  return true
}
