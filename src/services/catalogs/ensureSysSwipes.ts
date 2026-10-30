import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Category } from '../../types/category.ts'
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

export function getSysSwipesEnsureRecovery(): EnsureSysSwipesResult | null {
  if (hasSysSwipesLocally()) {
    return { status: 'ready' }
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
  if (!isCurrent()) {
    return { status: 'recoverable', reason: 'stale' }
  }
  if (hasSysSwipesLocally()) {
    lastRecoverable = null
    return { status: 'ready' }
  }

  const catalog = createSysSwipesCatalog()
  try {
    await libraryClient.createCategory(catalog)
  } catch (error) {
    if (error instanceof LibraryHttpError && error.status === 409) {
      return mergeSysSwipesFromServer(isCurrent)
    }
    const result: EnsureSysSwipesResult = {
      status: 'recoverable',
      reason: 'create_failed',
    }
    lastRecoverable = result
    return result
  }

  if (!isCurrent()) {
    return { status: 'recoverable', reason: 'stale' }
  }
  mergeCategoryLocally(catalog)
  lastRecoverable = null
  return { status: 'created' }
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
): Promise<EnsureSysSwipesResult> {
  try {
    const state = await libraryClient.loadState()
    if (!isCurrent()) {
      return { status: 'recoverable', reason: 'stale' }
    }
    const fromServer = state.categories.find(
      (category) => category.id === SYS_SWIPES_ID,
    )
    if (fromServer) {
      mergeCategoryLocally(fromServer)
      lastRecoverable = null
      return { status: 'ready' }
    }
    const missing: EnsureSysSwipesResult = {
      status: 'recoverable',
      reason: 'conflict_missing_on_reload',
    }
    lastRecoverable = missing
    return missing
  } catch {
    const failed: EnsureSysSwipesResult = {
      status: 'recoverable',
      reason: 'conflict_reload_failed',
    }
    lastRecoverable = failed
    return failed
  }
}
