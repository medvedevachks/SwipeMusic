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
  }) => void | Promise<void>
  busy?: boolean
  error?: string | null
}

export default function CreateCategoryForm({
  onCancel,
  onSubmit,
  busy = false,
  error = null,
}: CreateCategoryFormProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(categoryColorOptions[4])
  const [icon, setIcon] = useState<CategoryIconId>('music')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || busy) {
      return
    }
    void onSubmit({ name: trimmed, color, icon })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        // Без preventDefault браузер делает GET на текущий URL и сбрасывает in-memory store.
        event.preventDefault()
        event.stopPropagation()
        submit()
      }}
    >
      {error ? (
        <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset disabled={busy} className="min-w-0 space-y-4 border-0 p-0">
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
      </fieldset>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-fg)] disabled:opacity-40"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={!name.trim() || busy}
          aria-busy={busy || undefined}
          className="flex-1 rounded-xl bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Сохранение…' : 'Создать'}
        </button>
      </div>
    </form>
  )
}
