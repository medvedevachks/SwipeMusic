import { Link } from 'react-router-dom'

export default function Profile() {
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
        Профиль
      </h1>
      <div className="flex flex-col gap-2">
        <Link
          to="/queue"
          className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Очередь воспроизведения
        </Link>
        <Link
          to="/sources"
          className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Источники музыки
        </Link>
      </div>
    </section>
  )
}
