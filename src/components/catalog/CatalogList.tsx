import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getCategoryGlyph } from '../../config/categoryPresets'
import {
  canonicalCatalogCount,
  listCanonicalItems,
} from '../../services/canonical/selectors'
import {
  formatCatalogTrackCount,
  listCatalogs,
} from '../../services/catalogs/selectCatalogs'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { useCollectionStore } from '../../store/collectionStore'
import CreateCategoryForm from '../CreateCategoryForm'

export function CatalogList() {
  const categories = useCollectionStore((state) => state.categories)
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const createCategory = useCollectionStore((state) => state.createCategory)
  const canonicalItems = listCanonicalItems(Object.values(itemsById))
  const [creating, setCreating] = useState(false)
  const catalogs = listCatalogs(categories)

  return (
    <section className="space-y-3" aria-label="Мои каталоги">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          Мои каталоги
        </h2>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          onClick={() => setCreating((open) => !open)}
        >
          Создать каталог
        </button>
      </div>

      {creating ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <CreateCategoryForm
            onCancel={() => setCreating(false)}
            onSubmit={(input) => {
              createCategory(input)
              setCreating(false)
            }}
          />
        </div>
      ) : null}

      {catalogs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-muted)]">
          У вас пока нет каталогов
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {catalogs.map((catalog) => {
            const count = canonicalCatalogCount(canonicalItems, catalog.id)
            return (
              <li key={catalog.id}>
                <Link
                  to={`/library/catalogs/${encodeURIComponent(catalog.id)}`}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg text-white"
                    style={{ backgroundColor: catalog.color }}
                    aria-hidden="true"
                  >
                    {getCategoryGlyph(catalog.icon)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                      {catalog.name}
                      {catalog.favorite ? ' ★' : ''}
                    </span>
                    <span className="block text-xs text-[var(--color-muted)]">
                      {formatCatalogTrackCount(count)}
                      {catalog.system ? ' · системный' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
