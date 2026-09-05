import { useMemo, useState } from 'react'
import { getCategoryGlyph } from '../config/categoryPresets'
import type { Category } from '../types/category'
import BottomSheet from './BottomSheet'
import CreateCategoryForm from './CreateCategoryForm'

type CategoryPickerSheetProps = {
  open: boolean
  trackTitle?: string
  categories: Category[]
  onClose: () => void
  onSelect: (categoryId: string) => void
  onCreateCategory: (input: {
    name: string
    color: string
    icon: Category['icon']
  }) => Category
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
    setMode('list')
    setQuery('')
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      title={mode === 'list' ? 'Выберите категорию' : 'Новая категория'}
      onClose={handleClose}
    >
      {mode === 'create' ? (
        <CreateCategoryForm
          onCancel={() => setMode('list')}
          onSubmit={(input) => {
            const category = onCreateCategory(input)
            setMode('list')
            setQuery('')
            onSelect(category.id)
          }}
        />
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
            placeholder="Поиск категорий"
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
                Категории не найдены
              </li>
            )}
          </ul>

          <button
            type="button"
            onClick={() => setMode('create')}
            className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-sm font-medium text-[var(--color-accent)]"
          >
            Создать категорию
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
