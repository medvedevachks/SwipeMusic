import type { LibraryNode } from '../../types/libraryProvider'

type LibraryBreadcrumbProps = {
  items: LibraryNode[]
  onNavigate: (nodeId: string) => void
}

export function LibraryBreadcrumb({ items, onNavigate }: LibraryBreadcrumbProps) {
  if (items.length === 0) {
    return null
  }

  return (
    <nav
      className="flex flex-wrap items-center gap-1 text-sm text-[var(--color-muted)]"
      aria-label="Навигация"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={item.id} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden>›</span> : null}
            {isLast ? (
              <span className="font-medium text-[var(--color-fg)]">
                {item.title}
              </span>
            ) : (
              <button
                type="button"
                className="hover:text-[var(--color-accent)]"
                onClick={() => onNavigate(item.id)}
              >
                {item.title}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
