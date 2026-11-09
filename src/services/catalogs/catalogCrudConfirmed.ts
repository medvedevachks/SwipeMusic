import { getCollectionEngine } from '../collectionEngine/index.ts'
import {
  captureAuthSession,
  isAuthSessionCurrent,
  StaleLibrarySessionError,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'
import { LibraryHttpError, libraryClient } from '../libraryPersistence/client.ts'
import { mapLibraryState } from '../libraryPersistence/mapLibraryState.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Category, CategoryIconId } from '../../types/category.ts'
import { createId } from '../../utils/id.ts'

export const CATALOG_SYNC_AMBIGUOUS_MESSAGE =
  'Не удалось подтвердить сохранение. Проверьте список каталогов или повторите позже.'

export class CatalogSyncAmbiguousError extends Error {
  readonly catalogId: string

  constructor(catalogId: string, message = CATALOG_SYNC_AMBIGUOUS_MESSAGE) {
    super(message)
    this.name = 'CatalogSyncAmbiguousError'
    this.catalogId = catalogId
  }
}

export type CreateCategoryConfirmedInput = {
  name: string
  color: string
  icon: CategoryIconId
  description?: string
  favorite?: boolean
  /** Повтор после неоднозначного CREATE — тот же id, без нового POST-id. */
  id?: string
}

export type UpdateCategoryConfirmedInput = {
  name: string
}

const createFlights = new Map<string, Promise<Category>>()
const updateFlights = new Map<string, Promise<Category>>()
const deleteFlights = new Map<string, Promise<void>>()

/** Сетевой сбой без HTTP-статуса: сервер мог успеть принять запрос. */
export function isAmbiguousCatalogTransportError(error: unknown): boolean {
  if (error instanceof LibraryHttpError) {
    return false
  }
  if (error instanceof StaleLibrarySessionError) {
    return false
  }
  if (error instanceof CatalogSyncAmbiguousError) {
    return true
  }
  if (error instanceof TypeError) {
    return true
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'NetworkError'
  }
  return false
}

function assertActiveUser(session: AuthSessionSnapshot): void {
  if (!session.userId) {
    throw new StaleLibrarySessionError('LIBRARY_SESSION_ANONYMOUS')
  }
}

async function loadRemoteCategories(
  session: AuthSessionSnapshot,
): Promise<Category[] | null> {
  if (!isAuthSessionCurrent(session)) {
    return null
  }
  try {
    const dto = await libraryClient.loadState()
    if (!isAuthSessionCurrent(session)) {
      return null
    }
    return mapLibraryState(dto).categories
  } catch {
    return null
  }
}

function mergeCategoryLocal(category: Category): void {
  const categories = useCollectionStore.getState().categories
  const index = categories.findIndex((row) => row.id === category.id)
  if (index < 0) {
    useCollectionStore.setState({
      categories: [...categories, category],
    })
    return
  }
  const next = categories.slice()
  next[index] = category
  useCollectionStore.setState({ categories: next })
}

/**
 * Локальные последствия удаления каталога (membership only).
 * Вызывать только после подтверждённого DELETE или сверки, что каталога нет на сервере.
 */
export function applyCategoryDeletedLocally(id: string): void {
  const target = useCollectionStore.getState().categories.find((row) => row.id === id)
  if (!target || target.system) {
    return
  }

  const trackIds = useCollectionStore
    .getState()
    .assignments.filter((assignment) => assignment.categoryId === id)
    .map((assignment) => assignment.trackId)

  useCollectionStore.setState((state) => ({
    categories: state.categories.filter((category) => category.id !== id),
    assignments: state.assignments.filter(
      (assignment) => assignment.categoryId !== id,
    ),
  }))
  const engine = getCollectionEngine()
  for (const trackId of trackIds) {
    engine.removeCategory(trackId, id)
  }
  useCanonicalLibraryStore.getState().dropCatalog(id)
}

/**
 * Создаёт каталог только после подтверждения сервером (POST /api/me/categories).
 * После await сверяет поколение сессии: чужой аккаунт не получает Zustand merge.
 */
export async function createCategoryConfirmed(
  input: CreateCategoryConfirmedInput,
): Promise<Category> {
  const session = captureAuthSession()
  assertActiveUser(session)

  const now = new Date().toISOString()
  const category: Category = {
    id: input.id?.trim() || createId('cat'),
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

  const existingFlight = createFlights.get(category.id)
  if (existingFlight) {
    return existingFlight
  }

  const pending = (async () => {
    try {
      await libraryClient.createCategory(category)
    } catch (error) {
      if (isAmbiguousCatalogTransportError(error)) {
        const remote = await loadRemoteCategories(session)
        const found = remote?.find((row) => row.id === category.id)
        if (found) {
          if (!isAuthSessionCurrent(session)) {
            throw new StaleLibrarySessionError()
          }
          mergeCategoryLocal(found)
          return found
        }
        throw new CatalogSyncAmbiguousError(category.id)
      }
      throw error
    }

    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }

    mergeCategoryLocal(category)
    return category
  })().finally(() => {
    if (createFlights.get(category.id) === pending) {
      createFlights.delete(category.id)
    }
  })

  createFlights.set(category.id, pending)
  return pending
}

/** PATCH имени только после ответа сервера; до успеха Zustand не меняется. */
export async function updateCategoryConfirmed(
  id: string,
  input: UpdateCategoryConfirmedInput,
): Promise<Category> {
  const session = captureAuthSession()
  assertActiveUser(session)

  const trimmed = input.name.trim()
  if (!trimmed) {
    throw new Error('CATALOG_NAME_EMPTY')
  }

  const current = useCollectionStore.getState().categories.find((row) => row.id === id)
  if (!current || current.system) {
    throw new Error('CATALOG_NOT_EDITABLE')
  }

  const existingFlight = updateFlights.get(id)
  if (existingFlight) {
    return existingFlight
  }

  const updated: Category = {
    ...current,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  }

  const pending = (async () => {
    try {
      await libraryClient.updateCategory(updated)
    } catch (error) {
      if (isAmbiguousCatalogTransportError(error)) {
        const remote = await loadRemoteCategories(session)
        const found = remote?.find((row) => row.id === id)
        if (!isAuthSessionCurrent(session)) {
          throw new StaleLibrarySessionError()
        }
        if (found) {
          mergeCategoryLocal(found)
          if (found.name === trimmed) {
            return found
          }
        }
        throw new CatalogSyncAmbiguousError(id)
      }
      throw error
    }

    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }

    mergeCategoryLocal(updated)
    return updated
  })().finally(() => {
    if (updateFlights.get(id) === pending) {
      updateFlights.delete(id)
    }
  })

  updateFlights.set(id, pending)
  return pending
}

/**
 * DELETE на сервере → только потом локальный drop membership.
 * Системные каталоги не удаляются.
 */
export async function deleteCategoryConfirmed(id: string): Promise<void> {
  const session = captureAuthSession()
  assertActiveUser(session)

  const target = useCollectionStore.getState().categories.find((row) => row.id === id)
  if (!target) {
    return
  }
  if (target.system) {
    throw new Error('CATALOG_SYSTEM_PROTECTED')
  }

  const existingFlight = deleteFlights.get(id)
  if (existingFlight) {
    return existingFlight
  }

  const pending = (async () => {
    try {
      await libraryClient.deleteCategory(id)
    } catch (error) {
      if (isAmbiguousCatalogTransportError(error)) {
        const remote = await loadRemoteCategories(session)
        if (!isAuthSessionCurrent(session)) {
          throw new StaleLibrarySessionError()
        }
        if (remote && !remote.some((row) => row.id === id)) {
          applyCategoryDeletedLocally(id)
          return
        }
        throw new CatalogSyncAmbiguousError(id)
      }
      throw error
    }

    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }

    applyCategoryDeletedLocally(id)
  })().finally(() => {
    if (deleteFlights.get(id) === pending) {
      deleteFlights.delete(id)
    }
  })

  deleteFlights.set(id, pending)
  return pending
}

/** Сброс in-flight для unit-тестов. */
export function clearCatalogCrudFlightsForTests(): void {
  createFlights.clear()
  updateFlights.clear()
  deleteFlights.clear()
}
