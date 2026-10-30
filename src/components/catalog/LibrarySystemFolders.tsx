import { Link } from 'react-router-dom'
import { getCategoryGlyph } from '../../config/categoryPresets'
import {
  canonicalCatalogCount,
  likedCanonicalItems,
  listCanonicalItems,
} from '../../services/canonical/selectors'
import { formatCatalogTrackCount } from '../../services/catalogs/selectCatalogs'
import {
  LIBRARY_SYSTEM_FOLDERS,
  SYS_SWIPES_ID,
  type LibrarySystemFolderId,
} from '../../services/catalogs/systemFolders'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'

function countForFolder(
  folderId: LibrarySystemFolderId,
  items: ReturnType<typeof listCanonicalItems>,
): number {
  switch (folderId) {
    case 'swipes':
      return canonicalCatalogCount(items, SYS_SWIPES_ID)
    case 'favorites':
      return likedCanonicalItems(items).length
    case 'my-music':
      return items.length
    default: {
      const _exhaustive: never = folderId
      void _exhaustive
      return 0
    }
  }
}

/** Компактные системные папки на главной Библиотеки. Без длинных списков. */
export function LibrarySystemFolders() {
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const items = listCanonicalItems(Object.values(itemsById))

  return (
    <section className="space-y-3" aria-label="Системные папки">
      <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
        Папки
      </h2>
      <ul className="grid gap-2 sm:grid-cols-3">
        {LIBRARY_SYSTEM_FOLDERS.map((folder) => {
          const count = countForFolder(folder.id, items)
          return (
            <li key={folder.id}>
              <Link
                to={folder.path}
                className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg text-white"
                  style={{ backgroundColor: folder.color }}
                  aria-hidden="true"
                >
                  {getCategoryGlyph(folder.icon)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                    {folder.name}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    {formatCatalogTrackCount(count)}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
