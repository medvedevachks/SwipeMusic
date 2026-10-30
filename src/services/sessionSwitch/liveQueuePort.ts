import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type { LiveQueuePort } from './ports.ts'

/** Адаптер PlaybackQueue → LiveQueuePort (одна live-очередь). */
export function wrapQueuePort(queue: PlaybackQueue): LiveQueuePort {
  return {
    exportSessionState: () => queue.exportSessionState(),
    exportRuntimeSessionState: () => queue.exportRuntimeSessionState(),
    importSessionState: (raw) => queue.importSessionState(raw),
    importRuntimeSessionState: (state, pending) =>
      queue.importRuntimeSessionState(state, pending),
    getPendingRemovalIds: () => queue.getPendingRemovalIds(),
    getPersistenceMode: () => queue.getPersistenceMode(),
    detachLegacyPersistence: () => queue.detachLegacyPersistence(),
    clear: () => queue.clear(),
  }
}
