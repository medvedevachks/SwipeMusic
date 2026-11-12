export {
  PlaybackSessionStore,
  MetaSessionMismatchError,
  InvalidDeviceIdError,
  createPlaybackSessionStore,
  createEmptySessionQueueSnapshot,
  cloneSessionQueueSnapshot,
  clonePlaybackSessionSlot,
  isMetaCompatibleWithSession,
} from './PlaybackSessionStore.ts'
export type { PlaybackSessionStoreOptions } from './PlaybackSessionStore.ts'
export {
  sanitizeSessionTrack,
  sanitizeSessionTracks,
  toSessionTrack,
  toSessionTracks,
  sanitizeCoverUrl,
  sessionTrackHasForbiddenFields,
} from './sanitizeTrack.ts'
export { clonePlaybackContext } from './cloneContext.ts'
export {
  validateSessionQueueSnapshot,
  validatePlaybackSessionSlot,
  assertSchemaVersion,
} from './validate.ts'
export type { ValidationIssue, ValidationResult } from './validate.ts'
export {
  getOrCreateStableDeviceId,
  isValidDeviceId,
  DEVICE_ID_STORAGE_KEY,
} from './deviceId.ts'
export type { StorageLike } from './deviceId.ts'
export {
  inspectLegacyPlaybackQueueV1,
  refuseLegacyV1Import,
} from './legacyV1.ts'
export type { LegacyV1Inspection } from './legacyV1.ts'
export {
  PlaybackSessionPersistence,
  PersistenceWriteError,
  createPlaybackSessionPersistence,
  materializeLoadResult,
  sessionsMetaStorageKey,
  sessionsSlotStorageKey,
  SESSIONS_META_KEY_PREFIX,
  SESSIONS_SLOT_KEY_PREFIX,
  DEFAULT_MAX_BYTES_PER_KEY,
} from './persistence.ts'
export type {
  PlaybackSessionPersistenceOptions,
  SessionsLoadResult,
  SlotLoadStatus,
  PersistenceWriteErrorCode,
} from './persistence.ts'
export {
  PLAYBACK_SESSION_SCHEMA_VERSION,
  PLAYBACK_SESSION_IDS,
} from './types.ts'
export type {
  PlaybackSessionId,
  PlaybackSessionSlot,
  PlaybackSessionStoreSnapshot,
  SessionQueueSnapshot,
  SessionSlotMeta,
  SessionPlaybackPhase,
  SessionSwitchToken,
  SessionTrack,
  SwipesSessionMeta,
  WaveSessionMeta,
  SearchSessionMeta,
  CatalogSessionMeta,
  AlbumSessionMeta,
  PersistedSessionsMetaV2,
  PersistedSessionSlotV2,
} from './types.ts'
