import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCategoryGlyph } from '../config/categoryPresets'
import { removeCanonicalFromCatalog } from '../services/canonical/userOrganization'
import {
  canonicalCatalogCount,
  canonicalTracksInCatalog,
  formatSourceCopyCount,
  listCanonicalItems,
} from '../services/canonical/selectors'
import {
  canDeleteCatalog,
  formatCatalogTrackCount,
  getCatalogById,
} from '../services/catalogs/selectCatalogs'
import { useCanonicalLibraryStore } from '../store/canonicalLibraryStore'
import { useCollectionStore } from '../store/collectionStore'
import { getSourceDisplayName } from '../utils/sourceDisplay'

export default function CatalogDetail() {
  const params = useParams()
  const navigate = useNavigate()
  const catalogId = params.catalogId ?? ''
  const categories = useCollectionStore((state) => state.categories)
  const itemsById = useCanonicalLibraryStore((state) => state.itemsById)
  const updateCategory = useCollectionStore((state) => state.updateCategory)
  const deleteCategory = useCollectionStore((state) => state.deleteCategory)

  const catalog = getCatalogById(categories, catalogId)
  const canonicalItems = listCanonicalItems(Object.values(itemsById))
  const tracks = canonicalTracksInCatalog(canonicalItems, catalogId)
  const count = canonicalCatalogCount(canonicalItems, catalogId)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removed, setRemoved] = useState(false)

  if (removed) {
    return null
  }

  if (!catalog) {
    return (
      <section className="space-y-4">
        <h1 className="font-display text-2xl font-semibold text-[var(--color-fg)]">
          Каталог не найден
        </h1>
        <Link
          to="/library"
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--color-border)] px-3 text-sm"
        >
          К библиотеке
        </Link>
      </section>
    )
  }

  const saveName = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    updateCategory(catalog.id, { name: trimmed })
    setRenaming(false)
  }

  return (
    <section className="space-y-4 pb-8">
      <Link
        to="/library"
        className="inline-flex min-h-11 items-center text-sm text-[var(--color-muted)]"
      >
        ← Библиотека
      </Link>

      <div className="flex items-start gap-3">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl text-white"
          style={{ backgroundColor: catalog.color }}
          aria-hidden="true"
        >
          {getCategoryGlyph(catalog.icon)}
        </span>
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            {catalog.name}
            {catalog.favorite ? ' ★' : ''}
          </h1>
          {catalog.description ? (
            <p className="text-sm text-[var(--color-muted)]">{catalog.description}</p>
          ) : null}
          <p className="text-sm text-[var(--color-muted)]">
            {formatCatalogTrackCount(count)}
          </p>
        </div>
      </div>

      {renaming ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveName()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Новое название каталога"
            className="min-h-11 min-w-[12rem] flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            autoFocus
          />
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-[var(--color-accent)] px-3 text-sm font-medium text-white"
          >
            Сохранить
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
            onClick={() => setRenaming(false)}
          >
            Отмена
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
            onClick={() => {
              setName(catalog.name)
              setRenaming(true)
              setConfirmDelete(false)
            }}
          >
            Переименовать
          </button>
          {canDeleteCatalog(catalog) ? (
            <button
              type="button"
              className="min-h-11 rounded-xl border border-rose-400 px-3 text-sm text-rose-700 dark:text-rose-300"
              onClick={() => setConfirmDelete(true)}
            >
              Удалить каталог
            </button>
          ) : null}
        </div>
      )}

      {confirmDelete ? (
        <div className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="text-sm text-[var(--color-fg)]">
            Удалить каталог «{catalog.name}»?
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            Треки останутся в библиотеке. Будет удалена только их принадлежность
            этому каталогу.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-xl bg-rose-600 px-3 text-sm font-medium text-white"
              onClick={() => {
                setRemoved(true)
                deleteCategory(catalog.id)
                navigate('/library')
              }}
            >
              Удалить
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm"
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {tracks.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-muted)]">
          В этом каталоге пока нет треков
        </p>
      ) : (
        <ul className="space-y-2">
          {tracks.map((item) => (
              <li
                key={item.canonicalTrack.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
              >
                <span
                  className="h-12 w-12 shrink-0 rounded-lg border border-[var(--color-border)]"
                  style={{
                    backgroundColor: 'var(--color-accent)',
                    backgroundImage: item.canonicalTrack.artworkUrl
                      ? `url(${item.canonicalTrack.artworkUrl})`
                      : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-fg)]">
                    {item.canonicalTrack.title}
                    {item.state.liked ? ' · лайк' : ''}
                  </span>
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    {item.canonicalTrack.artist}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-accent)]">
                      {formatSourceCopyCount(item.copies.length)}
                    </span>
                    {item.copies.map((copy) => (
                      <span
                        key={copy.sourceTrackKey}
                        className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]"
                      >
                        {getSourceDisplayName(copy.sourceId)}
                      </span>
                    ))}
                  </span>
                </span>
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-xl border border-[var(--color-border)] px-3 text-xs"
                  onClick={() => {
                    void removeCanonicalFromCatalog(item.canonicalTrack.id, catalog.id)
                  }}
                >
                  Убрать из каталога
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
