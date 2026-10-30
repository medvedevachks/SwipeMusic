export {
  SessionSwitchCoordinator,
  createSessionSwitchCoordinator,
} from './SessionSwitchCoordinator.ts'
export type {
  CoordinatorPhase,
  SwitchResult,
  SessionSwitchCoordinatorOptions,
} from './SessionSwitchCoordinator.ts'
export type {
  TrackPreparePort,
  TrackPrepareRequest,
  PreparedTrackHandle,
  LiveQueuePort,
  PhysicalPlayerPort,
  CommitPlayInput,
  CommitPlayResult,
  RollbackPlayInput,
  RollbackPlayResult,
  SessionSwitchPersistPort,
  SwitchPlayRequest,
} from './ports.ts'
export {
  prepareExistingLiveQueueForSessionMode,
  PLAYBACK_BUG_01,
} from './migrateLiveQueue.ts'
export type { PrepareLiveQueueForSessionModeOptions } from './migrateLiveQueue.ts'
export {
  sessionQueueToPlaybackQueueState,
  playbackExportToSessionQueue,
  captureRuntimePlaybackAnchor,
} from './queueSnapshotBridge.ts'
export type {
  LiveRuntimeCapture,
  RuntimePlaybackAnchor,
} from './ports.ts'
export {
  isSessionSwitchIntegrationEnabled,
  setSessionSwitchIntegrationEnabledForTests,
  resetSessionSwitchIntegrationFlagForTests,
  SESSION_SWITCH_INTEGRATION_STORAGE_KEY,
  createSessionSwitchRuntime,
  handoffLiveQueueAfterAuth,
  teardownLiveQueueOnLogout,
  createResolverTrackPreparePort,
  createAdapterPhysicalPort,
  createAudioPlayerPhysicalPort,
  PreparedTrackCache,
  createControllablePlayerAdapter,
  bindPlaybackSessionsForAuth,
  teardownPlaybackSessionsForAuth,
  playCatalogViaSessionSwitch,
  expandCatalogSessionQueue,
  releaseCatalogSessionForLegacyIntent,
  getSessionSwitchAppRuntime,
  getSessionSwitchCoordinator,
} from './integration/index.ts'
export type {
  SessionSwitchRuntime,
  CreateSessionSwitchRuntimeOptions,
  AuthQueueHandoffInput,
  AuthQueueHandoffResult,
  ResolvePlaybackFn,
  AdapterPhysicalPort,
  AudioPlayerSessionApi,
  BindPlaybackSessionsResult,
} from './integration/index.ts'
