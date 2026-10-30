export {
  playUserCatalog,
  resetCatalogPlaybackGate,
  cancelCatalogPlaybackGate,
  type PlayUserCatalogDeps,
  type PlayUserCatalogInput,
  type PlayUserCatalogResult,
} from './playUserCatalog.ts'
export {
  applyCatalogLoopRepeat,
  applyCatalogLoopRepeatIfOwned,
  ensureCatalogRepeatPolicyWatcher,
  noteUserRepeatModeChange,
  resetCatalogRepeatPolicyForTests,
  syncCatalogRepeatPolicy,
} from './catalogRepeatPolicy.ts'
export { isAutoplayBlockedError } from './autoplayBlocked.ts'
export {
  buildCatalogPlaybackQueue,
  resolveCatalogItemPlayback,
  type BuildCatalogPlaybackQueueInput,
  type BuildCatalogPlaybackQueueResult,
  type CatalogItemResolution,
  type CatalogQueueEntry,
} from './buildCatalogPlaybackQueue.ts'
export { resolveMissingCatalogTrack } from './resolveMissingCatalogTrack.ts'
export {
  CATALOG_PLAYBACK_MESSAGE,
  type CatalogPlaybackMessage,
} from './messages.ts'
export {
  CATALOG_PREPARE_CONCURRENCY,
  mapPool,
} from './mapPool.ts'
