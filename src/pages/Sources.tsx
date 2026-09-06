import { sourceTypeLabel } from '../sources'
import { useSourceManagerStore } from '../store/sourceManagerStore'
import type { SourceType } from '../types/source'

const ADDABLE_TYPES: SourceType[] = [
  'api',
  'html-parser',
  'rss',
  'local-folder',
  'custom',
]

export default function Sources() {
  const sources = useSourceManagerStore((state) => state.sources)
  const addSource = useSourceManagerStore((state) => state.addSource)
  const removeSource = useSourceManagerStore((state) => state.removeSource)
  const enableSource = useSourceManagerStore((state) => state.enableSource)
  const disableSource = useSourceManagerStore((state) => state.disableSource)

  return (
    <section className="space-y-5 pb-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Источники
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Управление источниками музыки. Реальное подключение API — позже.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white"
          onClick={() => {
            const type =
              ADDABLE_TYPES[Math.floor(Math.random() * ADDABLE_TYPES.length)]
            addSource({
              name: `Новый источник (${sourceTypeLabel(type)})`,
              type,
              enabled: false,
            })
          }}
        >
          Добавить источник
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th className="px-3 py-3 font-medium">Название</th>
              <th className="px-3 py-3 font-medium">Тип</th>
              <th className="px-3 py-3 font-medium">Включён</th>
              <th className="px-3 py-3 font-medium">Приоритет</th>
              <th className="px-3 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr
                key={source.id}
                className="border-b border-[var(--color-border)] last:border-b-0"
              >
                <td className="px-3 py-3 font-medium text-[var(--color-fg)]">
                  {source.name}
                </td>
                <td className="px-3 py-3 text-[var(--color-muted)]">
                  {sourceTypeLabel(source.type)}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={
                      source.enabled
                        ? 'text-[var(--color-accent)]'
                        : 'text-[var(--color-muted)]'
                    }
                  >
                    {source.enabled ? 'Да' : 'Нет'}
                  </span>
                </td>
                <td className="px-3 py-3 text-[var(--color-muted)]">
                  {source.priority}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {source.enabled ? (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-fg)] disabled:opacity-40"
                        disabled={source.id === 'mock' && source.enabled}
                        onClick={() => disableSource(source.id)}
                      >
                        Отключить
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-fg)]"
                        onClick={() => enableSource(source.id)}
                      >
                        Включить
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-xs text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                      disabled={source.id === 'mock'}
                      onClick={() => removeSource(source.id)}
                    >
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
