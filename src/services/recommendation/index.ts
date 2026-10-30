export {
  recommendNext,
  recommendNextLegacy,
  recommendationStrategyFingerprint,
  sameRecommendationStrategy,
} from './engine.ts'
export {
  pickContinuousRandom,
  collectContinuousPlayableBatch,
  CONTINUOUS_RANDOM_STRATEGY,
  CONTINUOUS_DISCOVERY_QUERIES,
} from './continuousRandomV1.ts'
export { CONTINUOUS_LIMITS } from './continuousLimits.ts'
export {
  invalidateContinuousBuffer,
  resetContinuousBufferForTests,
  getContinuousBufferSize,
  CONTINUOUS_BUFFER_TARGET,
  requestContinuousBufferRefill,
} from './continuousBuffer.ts'
export {
  clearContinuousDiscoveryRuntime,
  beginContinuousDiscoveryOperation,
  getContinuousDiscoveryGeneration,
  getContinuousDiscoverySnapshot,
  getContinuousPoolSize,
  getContinuousPagesFetched,
  isContinuousDiscoveryOperationCurrent,
  resetContinuousDiscoveryForTests,
} from './continuousSession.ts'
export type { RecommendationStrategy } from './types.ts'
export { createRecommendationContinuationProvider } from './continuationBridge.ts'
export type { RecommendationContinuationDeps } from './continuationBridge.ts'
export {
  isRecommendationAdvanceContext,
  consumeRecommendationAdvance,
  resolveRecommendationAdvance,
  prepareRecommendationFollowUp,
} from './advance.ts'
export {
  isRecommendationHomeDeckContext,
  buildPlaybackDeckTracks,
  resolveHomeDeckTracks,
  resolveHomeDeckFocusId,
} from './homeDeck.ts'
export type { HomeDeckResolution, HomeDeckSource, HomeDeckStage } from './homeDeck.ts'
export {
  activateRecommendationSession,
  clearRecommendationSession,
  pickRecommendationStart,
  commitRecommendationSeed,
  enqueueRecommendationAdvance,
  getRecommendationSessionMode,
  resetRecommendationSessionRuntimeForTests,
} from './sessionRuntime.ts'
export {
  invalidateRecommendationAdvance,
  getRecommendationAdvanceEpoch,
} from './advanceEpoch.ts'
export {
  getActiveRecommendationMode,
  setActiveRecommendationMode,
  markRecommendationExhausted,
  clearRecommendationExhausted,
  isRecommendationExhausted,
  noteRecommendationMiss,
  takeRecommendationMiss,
  peekRecommendationMiss,
  clearRecommendationMiss,
  resetRecommendationSessionStateForTests,
} from './sessionState.ts'
export type { ActiveRecommendationMode } from './sessionState.ts'
export {
  buildExclusionSets,
  copyIdentity,
  isExcludedTrack,
  normalizeText,
  titleIdentity,
} from './identity.ts'
export {
  RECOMMENDATION_LIMITS,
  type RecommendationCatalogPort,
  type RecommendationEmptyReason,
  type RecommendationExcludedTrack,
  type RecommendationHit,
  type RecommendationMiss,
  type RecommendationMode,
  type RecommendationReason,
  type RecommendationRequest,
  type RecommendationResult,
} from './types.ts'
