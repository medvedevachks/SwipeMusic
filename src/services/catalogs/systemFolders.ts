import type { Catalog } from '../../types/category.ts'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'

/** Стабильный id накопителя понравившихся неразобранных композиций. Не по русскому имени. */
export const SYS_SWIPES_ID = 'sys_swipes'

export const SYS_SWIPES_NAME = 'Свайпы'

export function createSysSwipesCatalog(now = new Date().toISOString()): Catalog {
  return {
    id: SYS_SWIPES_ID,
    name: SYS_SWIPES_NAME,
    icon: 'star',
    color: '#0d9488',
    description: 'Понравившиеся композиции для разбора по каталогам',
    createdAt: now,
    updatedAt: now,
    sortOrder: -100,
    favorite: false,
    system: true,
  }
}

export function isSwipeInboxCatalogId(catalogId: string): boolean {
  return catalogId === SYS_SWIPES_ID
}

/** Каталоги, в которые пользователь раскладывает музыку (не inbox). */
export function isUserOrganizationCatalog(catalog: Pick<Catalog, 'id'>): boolean {
  return !isSwipeInboxCatalogId(catalog.id)
}

export function listUserOrganizationCatalogs(
  catalogs: readonly Catalog[],
): Catalog[] {
  return catalogs.filter(isUserOrganizationCatalog)
}

export function itemHasUserCatalogMembership(
  item: Pick<CanonicalLibraryItem, 'catalogIds'>,
): boolean {
  return item.catalogIds.some((id) => !isSwipeInboxCatalogId(id))
}

export function itemInSwipeInbox(
  item: Pick<CanonicalLibraryItem, 'catalogIds'>,
): boolean {
  return item.catalogIds.includes(SYS_SWIPES_ID)
}

export type LibrarySystemFolderId = 'swipes' | 'favorites' | 'my-music'

export type LibrarySystemFolder = {
  id: LibrarySystemFolderId
  path: string
  name: string
  description: string
  icon: Catalog['icon']
  color: string
}

export const LIBRARY_SYSTEM_FOLDERS: readonly LibrarySystemFolder[] = [
  {
    id: 'swipes',
    path: '/library/swipes',
    name: SYS_SWIPES_NAME,
    description: 'Понравившиеся, ещё не разобранные',
    icon: 'star',
    color: '#0d9488',
  },
  {
    id: 'favorites',
    path: '/library/favorites',
    name: 'Избранное',
    description: 'Лайки Swipe Music',
    icon: 'heart',
    color: '#e11d48',
  },
  {
    id: 'my-music',
    path: '/library/my-music',
    name: 'Моя музыка',
    description: 'Все сохранённые композиции',
    icon: 'music',
    color: '#2563eb',
  },
]
