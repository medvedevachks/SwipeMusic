export {
  ContinuationSession,
  emptyContinuationProvider,
  getContinuationSession,
  resetContinuationSessionForTests,
} from './ContinuationSession.ts'
export {
  buildSearchHitExclusions,
  commitSearchSeedQueue,
  consumeSearchSeedAdvance,
  isSearchSeedPlaybackEnabled,
  planSearchPlayback,
  searchDeckUsesSeedPlayback,
  selectSearchPlaybackTracks,
  setSearchSeedPlaybackEnabled,
  sortingDeckFollowsPlayer,
  type SearchPlaybackPlan,
} from './searchSeedPlayback.ts'
export {
  getSearchPlaybackDebugEvents,
  getSearchPlaybackDebugSnapshot,
  installSearchPlaybackDebugBridge,
  isSearchPlaybackDebugEnabled,
  noteSearchPlaybackEvent,
} from './searchPlaybackDebug.ts'
export {
  beginSearchFlowCommand,
  clearSearchFlowDiagEvents,
  getSearchFlowDiagEvents,
  installSearchFlowDiagBridge,
  noteSearchFlowEvent,
} from './searchFlowDiag.ts'
export {
  isContinuationCandidateAvailable,
  type ContinuationCandidate,
  type ContinuationProvider,
  type ContinuationSignal,
} from './types.ts'
export {
  createSearchRecommendationProvider,
  ensureLibraryContinuation,
  ensureSearchRecommendation,
  resetSearchRecommendationRuntimeForTests,
  type SearchRecommendationRuntimeDeps,
} from './searchContinuationRuntime.ts'
