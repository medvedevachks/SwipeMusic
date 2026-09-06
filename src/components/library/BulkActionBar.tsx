type BulkActionBarProps = {
  count: number
  onClear: () => void
  onLike: () => void
  onUnlike: () => void
  onOpenInSwipes: () => void
  onCreateQueue: () => void
  onExport: () => void
}

export function BulkActionBar({
  count,
  onClear,
  onLike,
  onUnlike,
  onOpenInSwipes,
  onCreateQueue,
  onExport,
}: BulkActionBarProps) {
  if (count === 0) {
    return null
  }

  return (
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-nav)]/95 p-3 shadow-lg backdrop-blur">
      <span className="text-sm font-medium text-[var(--color-fg)]">
        Выбрано: {count}
      </span>
      <button type="button" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs" onClick={onLike}>
        Лайкнуть
      </button>
      <button type="button" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs" onClick={onUnlike}>
        Снять лайк
      </button>
      <button type="button" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs" onClick={onOpenInSwipes}>
        Открыть в свайпах
      </button>
      <button type="button" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs" onClick={onCreateQueue}>
        Очередь
      </button>
      <button type="button" className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs" onClick={onExport}>
        Экспорт
      </button>
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-xs text-rose-600" onClick={onClear}>
        Сбросить
      </button>
    </div>
  )
}
