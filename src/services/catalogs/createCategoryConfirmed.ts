import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Category, CategoryIconId } from '../../types/category.ts'
import { createId } from '../../utils/id.ts'
import {
  captureAuthSession,
  isAuthSessionCurrent,
  StaleLibrarySessionError,
} from '../auth/sessionEpoch.ts'
import { libraryClient } from '../libraryPersistence/client.ts'

export type CreateCategoryConfirmedInput = {
  name: string
  color: string
  icon: CategoryIconId
  description?: string
  favorite?: boolean
}

/**
 * Создаёт каталог только после подтверждения сервером (POST /api/me/categories).
 * После await сверяет поколение сессии: чужой аккаунт не получает Zustand merge.
 */
export async function createCategoryConfirmed(
  input: CreateCategoryConfirmedInput,
): Promise<Category> {
  const session = captureAuthSession()
  if (!session.userId) {
    throw new StaleLibrarySessionError('LIBRARY_SESSION_ANONYMOUS')
  }

  const now = new Date().toISOString()
  const category: Category = {
    id: createId('cat'),
    name: input.name.trim(),
    color: input.color,
    icon: input.icon,
    description: input.description?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    sortOrder: useCollectionStore.getState().categories.length,
    favorite: input.favorite ?? false,
    system: false,
  }

  await libraryClient.createCategory(category)

  if (!isAuthSessionCurrent(session)) {
    throw new StaleLibrarySessionError()
  }

  const categories = useCollectionStore.getState().categories
  if (!categories.some((row) => row.id === category.id)) {
    useCollectionStore.setState({
      categories: [...categories, category],
    })
  }
  return category
}
