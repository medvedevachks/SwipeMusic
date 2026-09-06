import type { LibraryGroup } from '../../types/library'

type LibraryGroupListProps = {
  groups: LibraryGroup[]
  emptyLabel: string
  onOpen: (groupKey: string) => void
}

export function LibraryGroupList({
  groups,
  emptyLabel,
  onOpen,
}: LibraryGroupListProps) {
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--color-muted)]">
        {emptyLabel}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {groups.map((group) => (
        <li key={group.key}>
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-hover)]"
            onClick={() => onOpen(group.key)}
          >
            <span className="font-medium text-[var(--color-fg)]">
              {group.label}
            </span>
            <span className="text-sm text-[var(--color-muted)]">
              {group.count}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
