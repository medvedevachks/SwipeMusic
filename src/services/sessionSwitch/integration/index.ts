export {
  isSessionSwitchIntegrationEnabled,
  setSessionSwitchIntegrationEnabledForTests,
  resetSessionSwitchIntegrationFlagForTests,
  SESSION_SWITCH_INTEGRATION_STORAGE_KEY,
} from '../featureFlag.ts'
export {
  PreparedTrackCache,
  createPreparedRef,
} from './preparedTrackCache.ts'
export type { PreparedTrackEntry } from './preparedTrackCache.ts'
export { sessionTrackAsTrack } from './sessionTrackAsTrack.ts'
export {
  createResolverTrackPreparePort,
} from './ResolverTrackPreparePort.ts'
export type {
  ResolvePlaybackFn,
  ResolverTrackPreparePortOptions,
} from './ResolverTrackPreparePort.ts'
export {
  createAdapterPhysicalPort,
  createAudioPlayerPhysicalPort,
} from './createPhysicalPlayerPort.ts'
export type {
  AdapterPhysicalPort,
  AudioPlayerSessionApi,
  PhysicalPortState,
} from './createPhysicalPlayerPort.ts'
export {
  commitPreparedPlayback,
  rollbackPreparedPlayback,
} from './sessionPhysicalEngine.ts'
export {
  handoffLiveQueueAfterAuth,
  teardownLiveQueueOnLogout,
} from './bootstrapSessionPlayback.ts'
export type {
  AuthQueueHandoffInput,
  AuthQueueHandoffResult,
  PlaybackIdentityClearPort,
} from './bootstrapSessionPlayback.ts'
export { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
export type {
  SessionSwitchRuntime,
  CreateSessionSwitchRuntimeOptions,
} from './createSessionSwitchRuntime.ts'
export {
  bindPlaybackSessionsForAuth,
  teardownPlaybackSessionsForAuth,
  resetPlaybackSessionBootstrapForTests,
} from './playbackSessionBootstrap.ts'
export type { BindPlaybackSessionsResult } from './playbackSessionBootstrap.ts'
export {
  playCatalogViaSessionSwitch,
  expandCatalogSessionQueue,
  isCatalogSessionPlaybackActive,
} from './playCatalogSession.ts'
export {
  playSearchViaSessionSwitch,
  isSearchSessionPlaybackActive,
} from './playSearchSession.ts'
export {
  playAlbumViaSessionSwitch,
  isAlbumSessionPlaybackActive,
} from './playAlbumSession.ts'
export {
  playSwipeViaSessionSwitch,
  isSwipeSessionPlaybackActive,
} from './playSwipeSession.ts'
export {
  playWaveViaSessionSwitch,
  isWaveSessionPlaybackActive,
} from './playWaveSession.ts'
export {
  bindCmeSessionOwnership,
  clearCmeSessionOwnership,
  isCmeLiveMutationAllowed,
  healCmeOwnershipIfStale,
  getCmeSessionOwnership,
  resetCmeSessionOwnershipForTests,
} from './cmeSessionOwnership.ts'
export {
  resolveAlbumExhaustedContinuation,
  getAlbumContinuationPort,
  setAlbumContinuationPortForTests,
} from './albumContinuationContract.ts'
export type {
  AlbumContinuationDecision,
  AlbumContinuationPort,
} from './albumContinuationContract.ts'
export {
  flushActiveSessionToStore,
  bumpFlushRevision,
  resetFlushRevisionForTests,
} from './flushActiveSession.ts'
export {
  startActiveSessionDurableSync,
  stopActiveSessionDurableSync,
} from './activeSessionDurableSync.ts'
export { restoreActiveSessionWithoutAutoplay } from './restoreActiveSession.ts'
export {
  releaseCatalogSessionForLegacyIntent,
  releaseActiveSessionForLegacyIntent,
} from './legacyQueueClaim.ts'
export {
  getSessionSwitchAppRuntime,
  getSessionSwitchCoordinator,
  resetSessionSwitchAppRuntimeForTests,
} from './sessionSwitchAppRuntime.ts'
export { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
export type { ControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
/* productionResolve.ts тянет PlaybackResolver/AudioPlayer — только из Vite-бандла */
