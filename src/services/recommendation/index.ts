export {
  recommendNext,
  recommendationStrategyFingerprint,
  sameRecommendationStrategy,
} from './engine.ts'
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
