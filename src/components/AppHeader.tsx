import { Link } from 'react-router-dom'

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)]/80 bg-[var(--color-bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <Link to="/" className="min-w-0">
          <span className="font-display text-lg font-semibold tracking-tight text-[var(--color-fg)] sm:text-xl">
            Swipe Music
          </span>
        </Link>
        <Link
          to="/search"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-hover)]"
          aria-label="Поиск"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </Link>
      </div>
    </header>
  )
}
