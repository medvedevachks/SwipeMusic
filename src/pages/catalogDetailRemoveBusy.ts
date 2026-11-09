import {
  isAuthSessionCurrent,
  type AuthSessionSnapshot,
} from '../services/auth/sessionEpoch.ts'

export type CatalogRemoveBusyState = {
  busyIds: ReadonlySet<string>
  error: string | null
}

export function createEmptyCatalogRemoveBusyState(): CatalogRemoveBusyState {
  return {
    busyIds: new Set(),
    error: null,
  }
}

/** Начать DELETE для id. Повтор того же id игнорируется. */
export function beginCatalogTrackRemove(
  state: CatalogRemoveBusyState,
  canonicalTrackId: string,
): { started: false; state: CatalogRemoveBusyState } | {
  started: true
  state: CatalogRemoveBusyState
} {
  if (state.busyIds.has(canonicalTrackId)) {
    return { started: false, state }
  }
  const busyIds = new Set(state.busyIds)
  busyIds.add(canonicalTrackId)
  return {
    started: true,
    state: {
      busyIds,
      error: null,
    },
  }
}

/** Завершить DELETE для id, не трогая busy других треков. */
export function finishCatalogTrackRemove(
  state: CatalogRemoveBusyState,
  canonicalTrackId: string,
): CatalogRemoveBusyState {
  if (!state.busyIds.has(canonicalTrackId)) {
    return state
  }
  const busyIds = new Set(state.busyIds)
  busyIds.delete(canonicalTrackId)
  return {
    busyIds,
    error: state.error,
  }
}

export function canApplyCatalogRemoveUiResult(input: {
  mounted: boolean
  sessionAtStart: AuthSessionSnapshot
}): boolean {
  return input.mounted && isAuthSessionCurrent(input.sessionAtStart)
}

export function applyCatalogRemoveResult(
  state: CatalogRemoveBusyState,
  input: {
    canonicalTrackId: string
    ok: boolean
    mounted: boolean
    sessionAtStart: AuthSessionSnapshot
    failureMessage: string
  },
): CatalogRemoveBusyState {
  const next = finishCatalogTrackRemove(state, input.canonicalTrackId)
  if (!canApplyCatalogRemoveUiResult(input)) {
    return {
      busyIds: next.busyIds,
      // Устаревший ответ не пишет ошибку в новый контекст.
      error: state.error,
    }
  }
  if (input.ok) {
    return {
      busyIds: next.busyIds,
      error: null,
    }
  }
  return {
    busyIds: next.busyIds,
    error: input.failureMessage,
  }
}
