import { useState } from 'react'
import {
  categoryColorOptions,
  categoryIconOptions,
} from '../config/categoryPresets'
import type { CategoryIconId } from '../types/category'

type CreateCategoryFormProps = {
  onCancel: () => void
  onSubmit: (input: {
    name: string
    color: string
    icon: CategoryIconId
  }) => void
}

export default function CreateCategoryForm({
  onCancel,
  onSubmit,
}: CreateCategoryFormProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(categoryColorOptions[4])
  const [icon, setIcon] = useState<CategoryIconId>('music')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) {
          return
        }
        onSubmit({ name: name.trim(), color, icon })
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">
          Название
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Например, Фокус"
          className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none ring-[var(--color-accent)] focus:ring-2"
          autoFocus
        />
      </label>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">
          Цвет
        </span>
        <div className="flex flex-wrap gap-2">
          {categoryColorOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Цвет ${option}`}
              onClick={() => setColor(option)}
              className={`h-8 w-8 rounded-full border-2 ${
                color === option
                  ? 'border-[var(--color-fg)]'
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: option }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">
          Иконка
        </span>
        <div className="grid grid-cols-4 gap-2">
          {categoryIconOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setIcon(option.id)}
              className={`rounded-xl border px-2 py-2 text-lg ${
                icon === option.id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                  : 'border-[var(--color-border)]'
              }`}
              aria-label={option.label}
            >
              {option.glyph}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-fg)]"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 rounded-xl bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Создать
        </button>
      </div>
    </form>
  )
}
