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
} from './bootstrapSessionPlayback.ts'
export { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
export type {
  SessionSwitchRuntime,
  CreateSessionSwitchRuntimeOptions,
} from './createSessionSwitchRuntime.ts'
export { createControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
export type { ControllablePlayerAdapter } from './ControllablePlayerAdapter.ts'
/* productionResolve.ts тянет PlaybackResolver/AudioPlayer — только из Vite-бандла */
