import {
  isAuthSessionCurrent,
  type AuthSessionSnapshot,
} from '../services/auth/sessionEpoch.ts'

export type CatalogRemoveContext = {
  catalogId: string
  generation: number
}

export type CatalogRemoveBusyState = CatalogRemoveContext & {
  busyIds: ReadonlySet<string>
  error: string | null
}

export function createCatalogRemoveBusyState(
  catalogId: string,
  generation = 0,
): CatalogRemoveBusyState {
  return {
    catalogId,
    generation,
    busyIds: new Set(),
    error: null,
  }
}

/** Смена каталога без unmount: новый generation, пустой busy. */
export function switchCatalogRemoveBusyState(
  state: CatalogRemoveBusyState,
  catalogId: string,
): CatalogRemoveBusyState {
  if (state.catalogId === catalogId) {
    return state
  }
  return createCatalogRemoveBusyState(catalogId, state.generation + 1)
}

export function getCatalogRemoveContext(
  state: CatalogRemoveBusyState,
): CatalogRemoveContext {
  return {
    catalogId: state.catalogId,
    generation: state.generation,
  }
}

/** Начать DELETE для id. Повтор того же id в том же контексте игнорируется. */
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
      ...state,
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
    ...state,
    busyIds,
  }
}

export function canApplyCatalogRemoveUiResult(input: {
  mounted: boolean
  sessionAtStart: AuthSessionSnapshot
  contextAtStart: CatalogRemoveContext
  current: CatalogRemoveContext
}): boolean {
  return (
    input.mounted &&
    isAuthSessionCurrent(input.sessionAtStart) &&
    input.contextAtStart.catalogId === input.current.catalogId &&
    input.contextAtStart.generation === input.current.generation
  )
}

/**
 * Применить результат DELETE.
 * Устаревший контекст (другой catalog / generation / session / unmount)
 * возвращает state без изменений — busy и error нового контекста не трогаем.
 */
export function applyCatalogRemoveResult(
  state: CatalogRemoveBusyState,
  input: {
    canonicalTrackId: string
    ok: boolean
    mounted: boolean
    sessionAtStart: AuthSessionSnapshot
    contextAtStart: CatalogRemoveContext
    failureMessage: string
  },
): CatalogRemoveBusyState {
  if (
    !canApplyCatalogRemoveUiResult({
      mounted: input.mounted,
      sessionAtStart: input.sessionAtStart,
      contextAtStart: input.contextAtStart,
      current: getCatalogRemoveContext(state),
    })
  ) {
    return state
  }
  const next = finishCatalogTrackRemove(state, input.canonicalTrackId)
  if (input.ok) {
    return {
      ...next,
      error: null,
    }
  }
  return {
    ...next,
    error: input.failureMessage,
  }
}
