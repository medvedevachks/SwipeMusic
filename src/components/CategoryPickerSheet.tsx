import { useEffect, useMemo, useRef, useState } from 'react'
import { getCategoryGlyph } from '../config/categoryPresets'
import {
  canApplyCategoryPickerCreate,
  isRetryableCategoryCreateError,
} from '../services/catalogs/categoryPickerCreateGuard.ts'
import { captureAuthSession } from '../services/auth/sessionEpoch.ts'
import { SAVE_FAILED_MESSAGE } from '../services/libraryPersistence/statusStore'
import type { Category } from '../types/category'
import BottomSheet from './BottomSheet'
import CreateCategoryForm from './CreateCategoryForm'

type CategoryPickerSheetProps = {
  open: boolean
  trackTitle?: string
  categories: Category[]
  onClose: () => void
  onSelect: (categoryId: string) => void
  /**
   * Может быть async: await серверного create до onSelect/assign.
   * Sync createCategory (CatalogList) тоже допустим.
   */
  onCreateCategory: (input: {
    name: string
    color: string
    icon: Category['icon']
  }) => Category | Promise<Category>
}

export default function CategoryPickerSheet({
  open,
  trackTitle,
  categories,
  onClose,
  onSelect,
  onCreateCategory,
}: CategoryPickerSheetProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return categories
    }

    return categories.filter((category) =>
      category.name.toLowerCase().includes(normalized),
    )
  }, [categories, query])

  const handleClose = () => {
    if (creating) {
      return
    }
    setMode('list')
    setQuery('')
    setCreateError(null)
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      title={mode === 'list' ? 'Выберите каталог' : 'Новый каталог'}
      onClose={handleClose}
    >
      {mode === 'create' ? (
        <div className="space-y-3">
          {createError ? (
            <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
              {createError}
            </p>
          ) : null}
          <fieldset disabled={creating} className="min-w-0 border-0 p-0">
            <CreateCategoryForm
              onCancel={() => {
                if (creating) {
                  return
                }
                setMode('list')
                setCreateError(null)
              }}
              onSubmit={(input) => {
                void (async () => {
                  const sessionAtStart = captureAuthSession()
                  setCreating(true)
                  setCreateError(null)
                  try {
                    const category = await Promise.resolve(onCreateCategory(input))
                    if (
                      !canApplyCategoryPickerCreate(
                        mountedRef.current,
                        sessionAtStart,
                      )
                    ) {
                      return
                    }
                    onSelect(category.id)
                    setMode('list')
                    setQuery('')
                  } catch (error) {
                    if (
                      !mountedRef.current ||
                      !isRetryableCategoryCreateError(error)
                    ) {
                      return
                    }
                    setCreateError(
                      `${SAVE_FAILED_MESSAGE} Каталог не создан — сохранение отменено.`,
                    )
                  } finally {
                    if (mountedRef.current) {
                      setCreating(false)
                    }
                  }
                })()
              }}
            />
          </fieldset>
          {creating ? (
            <p className="text-xs text-[var(--color-muted)]" role="status">
              Создание каталога…
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {trackTitle && (
            <p className="text-sm text-[var(--color-muted)]">
              Куда сохранить «{trackTitle}»?
            </p>
          )}

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск каталогов"
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none ring-[var(--color-accent)] focus:ring-2"
          />

          <ul className="space-y-1.5">
            {filtered.map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => onSelect(category.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    {getCategoryGlyph(category.icon)}
                  </span>
                  <span className="text-sm font-medium text-[var(--color-fg)]">
                    {category.name}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-6 text-center text-sm text-[var(--color-muted)]">
                Каталоги не найдены
              </li>
            )}
          </ul>

          <button
            type="button"
            onClick={() => {
              setCreateError(null)
              setMode('create')
            }}
            className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-sm font-medium text-[var(--color-accent)]"
          >
            Создать каталог
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
