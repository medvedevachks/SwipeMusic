import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Category } from '../../types/category.ts'
import {
  captureAuthSession,
  isAuthSessionCurrent,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError, libraryClient } from '../libraryPersistence/client.ts'
import { createSysSwipesCatalog, SYS_SWIPES_ID } from './systemFolders.ts'

export type EnsureSysSwipesResult =
  | { status: 'ready' }
  | { status: 'created' }
  | {
      status: 'recoverable'
      reason:
        | 'create_failed'
        | 'conflict_reload_failed'
        | 'conflict_missing_on_reload'
        | 'stale'
    }

let lastRecoverable: Extract<EnsureSysSwipesResult, { status: 'recoverable' }> | null =
  null
/** Владелец диагностического статуса — не отдаём B статус от A. */
let lastRecoverableSession: AuthSessionSnapshot | null = null

export function clearSysSwipesEnsureRecovery(): void {
  lastRecoverable = null
  lastRecoverableSession = null
}

export function getSysSwipesEnsureRecovery(): EnsureSysSwipesResult | null {
  if (hasSysSwipesLocally()) {
    return { status: 'ready' }
  }
  if (
    lastRecoverable &&
    lastRecoverableSession &&
    !isAuthSessionCurrent(lastRecoverableSession)
  ) {
    clearSysSwipesEnsureRecovery()
    return null
  }
  return lastRecoverable
}

/**
 * Один системный накопитель на пользователя. Id стабильный (sys_swipes).
 * 409 → перечитать сервер; при ошибке GET не синтезировать «успех» из шаблона.
 * Soft-fail: остальная библиотека остаётся доступной.
 */
export async function ensureSysSwipesCategory(
  isCurrent: () => boolean = () => true,
): Promise<EnsureSysSwipesResult> {
  const session = captureAuthSession()
  if (!isCurrent() || !session.userId) {
    return { status: 'recoverable', reason: 'stale' }
  }
  if (hasSysSwipesLocally()) {
    clearSysSwipesEnsureRecovery()
    return { status: 'ready' }
  }

  const catalog = createSysSwipesCatalog()
  try {
    await libraryClient.createCategory(catalog)
  } catch (error) {
    if (error instanceof LibraryHttpError && error.status === 409) {
      return mergeSysSwipesFromServer(isCurrent, session)
    }
    return rememberRecoverable('create_failed', session)
  }

  if (!isCurrent() || !isAuthSessionCurrent(session)) {
    return { status: 'recoverable', reason: 'stale' }
  }
  mergeCategoryLocally(catalog)
  clearSysSwipesEnsureRecovery()
  return { status: 'created' }
}

function rememberRecoverable(
  reason:
    | 'create_failed'
    | 'conflict_reload_failed'
    | 'conflict_missing_on_reload',
  session: AuthSessionSnapshot,
): EnsureSysSwipesResult {
  if (!isAuthSessionCurrent(session)) {
    clearSysSwipesEnsureRecovery()
    return { status: 'recoverable', reason: 'stale' }
  }
  const result: Extract<EnsureSysSwipesResult, { status: 'recoverable' }> = {
    status: 'recoverable',
    reason,
  }
  lastRecoverable = result
  lastRecoverableSession = session
  return result
}

function hasSysSwipesLocally(): boolean {
  return useCollectionStore
    .getState()
    .categories.some((category) => category.id === SYS_SWIPES_ID)
}

function mergeCategoryLocally(catalog: Category): void {
  const categories = useCollectionStore.getState().categories
  if (categories.some((category) => category.id === SYS_SWIPES_ID)) {
    return
  }
  useCollectionStore.setState({
    categories: [...categories, catalog],
  })
}

async function mergeSysSwipesFromServer(
  isCurrent: () => boolean,
  session: AuthSessionSnapshot,
): Promise<EnsureSysSwipesResult> {
  try {
    const state = await libraryClient.loadState()
    if (!isCurrent() || !isAuthSessionCurrent(session)) {
      return { status: 'recoverable', reason: 'stale' }
    }
    const fromServer = state.categories.find(
      (category) => category.id === SYS_SWIPES_ID,
    )
    if (fromServer) {
      mergeCategoryLocally(fromServer)
      clearSysSwipesEnsureRecovery()
      return { status: 'ready' }
    }
    return rememberRecoverable('conflict_missing_on_reload', session)
  } catch {
    return rememberRecoverable('conflict_reload_failed', session)
  }
}
