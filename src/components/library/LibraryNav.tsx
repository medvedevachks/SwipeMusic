import type { LibrarySectionDefinition } from '../../types/library'

type LibraryNavProps = {
  sections: readonly LibrarySectionDefinition[]
  activeId: string
  onSelect: (id: LibrarySectionDefinition['id']) => void
}

export function LibraryNav({ sections, activeId, onSelect }: LibraryNavProps) {
  return (
    <nav
      className="flex gap-2 overflow-x-auto pb-1 sm:flex-col sm:overflow-visible"
      aria-label="Разделы библиотеки"
    >
      {sections.map((section) => {
        const active = section.id === activeId
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            className={[
              'shrink-0 rounded-xl px-3 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-[var(--color-accent)] font-medium text-white'
                : 'border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]',
            ].join(' ')}
          >
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}
