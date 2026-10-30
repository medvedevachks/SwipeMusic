import {
  isAuthSessionCurrent,
  StaleLibrarySessionError,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'

/** После await create: применять onSelect только если sheet жив и сессия та же. */
export function canApplyCategoryPickerCreate(
  mounted: boolean,
  sessionAtStart: AuthSessionSnapshot,
): boolean {
  return mounted && isAuthSessionCurrent(sessionAtStart)
}

/** Смена сессии / logout — не показывать SAVE_FAILED и не предлагать retry. */
export function isRetryableCategoryCreateError(error: unknown): boolean {
  return !(error instanceof StaleLibrarySessionError)
}
