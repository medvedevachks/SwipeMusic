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
  beginCatalogLoopSession,
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
export {
  beginCatalogExpandGate,
  cancelCatalogExpandGate,
  completeCatalogExpandGate,
  flushDeferredCatalogNav,
  getDeferredCatalogNav,
  isCatalogExpandGateActive,
  resetCatalogExpandNavigationForTests,
  tryDeferCatalogNav,
  type CatalogExpandNavCommand,
  type CatalogExpandNavFlushDeps,
} from './catalogExpandNavigation.ts'
export {
  prepareCatalogNeighborWindow,
} from './prepareCatalogNeighborWindow.ts'
