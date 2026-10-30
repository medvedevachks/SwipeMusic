import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Category } from '../../types/category.ts'
import { LibraryHttpError, libraryClient } from '../libraryPersistence/client.ts'
import { createSysSwipesCatalog, SYS_SWIPES_ID } from './systemFolders.ts'

/**
 * Один системный накопитель на пользователя. Id стабильный (sys_swipes), не по имени.
 * 409 CATEGORY_EXISTS — перечитать сервер; не валить весь bootstrap.
 * Прочие ошибки ensure — soft-fail (библиотека остаётся usable).
 */
export async function ensureSysSwipesCategory(
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) {
    return
  }
  if (hasSysSwipesLocally()) {
    return
  }

  const catalog = createSysSwipesCatalog()
  try {
    await libraryClient.createCategory(catalog)
  } catch (error) {
    if (error instanceof LibraryHttpError && error.status === 409) {
      await mergeSysSwipesFromServer(isCurrent)
      return
    }
    // Soft-fail: inbox появится на следующем bootstrap / ручном refresh.
    return
  }

  if (!isCurrent()) {
    return
  }
  mergeCategoryLocally(catalog)
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

async function mergeSysSwipesFromServer(isCurrent: () => boolean): Promise<void> {
  try {
    const state = await libraryClient.loadState()
    if (!isCurrent()) {
      return
    }
    const fromServer = state.categories.find(
      (category) => category.id === SYS_SWIPES_ID,
    )
    if (fromServer) {
      mergeCategoryLocally(fromServer)
      return
    }
  } catch {
    // fall through to local synthesize
  }
  if (!isCurrent()) {
    return
  }
  mergeCategoryLocally(createSysSwipesCatalog())
}
