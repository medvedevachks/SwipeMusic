import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCategoryGlyph } from '../../config/categoryPresets'
import {
  canonicalCatalogCount,
  listCanonicalItems,
} from '../../services/canonical/selectors'
import {
  CatalogSyncAmbiguousError,
  createCategoryConfirmed,
  isAmbiguousCatalogTransportError,
} from '../../services/catalogs/catalogCrudConfirmed'
import { isRetryableCategoryCreateError } from '../../services/catalogs/categoryPickerCreateGuard'
import {
  formatCatalogTrackCount,
  listCatalogs,
} from '../../services/catalogs/selectCatalogs'
import { listUserOrganizationCatalogs } from '../../services/catalogs/systemFolders'
import { createId } from '../../utils/id'
import { SAVE_FAILED_MESSAGE } from '../../services/libraryPersistence/statusStore'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore'
import { useCollectionStore } from '../../store/collectionStore'
import type { Catalog } from '../../types/category'
import CreateCategoryForm from '../CreateCategoryForm'

export type CatalogListProps = {
  /**
   * link — библиотека (переход в детали).
   * play — главная: Play запускает каталог, правка — отдельное действие.
   */
  mode?: 'link' | 'play'
  heading?: string
  showCreate?: boolean
  /** Каталог с активным playlist-контекстом. */
  activeCatalogId?: string | null
  /** Каталог, для которого идёт подготовка / запуск. */
  busyCatalogId?: string | null
  onPlayCatalog?: (catalog: Catalog) => void
}

export function CatalogList({
  mode = 'link',
  heading = 'Мои каталоги',
  showCreate = true,
  activeCatalogId = null,
  busyCatalogId = null,
  onPlayCatalog,
}: CatalogListProps) {
  const categories = useCollectionStore((state) => state.categories)
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const canonicalItems = listCanonicalItems(Object.values(itemsById))
  const [creating, setCreating] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  /** Стабильный id на время retry после неоднозначного CREATE. */
  const pendingCreateIdRef = useRef<string | null>(null)
  const catalogs = listCatalogs(listUserOrganizationCatalogs(categories))

  const closeCreateForm = () => {
    if (createBusy) {
      return
    }
    setCreating(false)
    setCreateError(null)
    pendingCreateIdRef.current = null
  }

  return (
    <section className="space-y-3" aria-label="Мои каталоги">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          {heading}
        </h2>
        {showCreate ? (
          <button
            type="button"
            className="min-h-11 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={createBusy}
            onClick={() => {
              if (creating) {
                closeCreateForm()
                return
              }
              setCreating(true)
              setCreateError(null)
            }}
          >
            Создать каталог
          </button>
        ) : null}
      </div>

      {creating ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <CreateCategoryForm
            busy={createBusy}
            error={createError}
            onCancel={closeCreateForm}
            onSubmit={async (input) => {
              if (createBusy) {
                return
              }
              setCreateBusy(true)
              setCreateError(null)
              if (!pendingCreateIdRef.current) {
                pendingCreateIdRef.current = createId('cat')
              }
              try {
                await createCategoryConfirmed({
                  ...input,
                  id: pendingCreateIdRef.current,
                })
                pendingCreateIdRef.current = null
                setCreating(false)
                setCreateError(null)
              } catch (error) {
                if (!isRetryableCategoryCreateError(error)) {
                  pendingCreateIdRef.current = null
                  setCreating(false)
                  setCreateError(null)
                  return
                }
                if (
                  error instanceof CatalogSyncAmbiguousError ||
                  isAmbiguousCatalogTransportError(error)
                ) {
                  setCreateError(
                    error instanceof CatalogSyncAmbiguousError
                      ? error.message
                      : `${SAVE_FAILED_MESSAGE} Результат не подтверждён — повторите без смены названия.`,
                  )
                  return
                }
                setCreateError(
                  `${SAVE_FAILED_MESSAGE} Каталог не создан — можно повторить.`,
                )
              } finally {
                setCreateBusy(false)
              }
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
            const isActive = activeCatalogId === catalog.id
            const isBusy = busyCatalogId === catalog.id
            const detailTo = `/library/catalogs/${encodeURIComponent(catalog.id)}`
            const meta = (
              <>
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg text-white"
                  style={{ backgroundColor: catalog.color }}
                  aria-hidden="true"
                >
                  {getCategoryGlyph(catalog.icon)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                    {catalog.name}
                    {catalog.favorite ? ' ★' : ''}
                  </span>
                  <span className="block text-xs text-[var(--color-muted)]">
                    {formatCatalogTrackCount(count)}
                    {catalog.system ? ' · системный' : ''}
                    {isActive ? ' · играет' : ''}
                    {isBusy ? ' · подготовка…' : ''}
                  </span>
                </span>
              </>
            )

            if (mode === 'play') {
              return (
                <li key={catalog.id}>
                  <div
                    className={[
                      'flex min-h-11 items-center gap-2 rounded-2xl border px-2 py-2 sm:gap-3 sm:px-3 sm:py-3',
                      isActive
                        ? 'border-[var(--color-accent)] bg-[var(--color-surface)] ring-1 ring-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)]',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
                      aria-current={isActive ? 'true' : undefined}
                      aria-busy={isBusy || undefined}
                      disabled={Boolean(busyCatalogId)}
                      onClick={() => onPlayCatalog?.(catalog)}
                    >
                      {meta}
                    </button>
                    <Link
                      to={detailTo}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-muted)]"
                      aria-label={`Открыть каталог «${catalog.name}»`}
                    >
                      Открыть
                    </Link>
                  </div>
                </li>
              )
            }

            return (
              <li key={catalog.id}>
                <Link
                  to={detailTo}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3"
                >
                  {meta}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
