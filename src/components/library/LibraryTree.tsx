import type { LibraryNode } from '../../types/libraryProvider'

type LibraryTreeProps = {
  roots: LibraryNode[]
  childrenMap: Record<string, LibraryNode[]>
  expandedIds: string[]
  selectedNodeId: string | null
  onToggle: (nodeId: string) => void
  onSelect: (nodeId: string) => void
}

function TreeNodeView({
  node,
  depth,
  childrenMap,
  expandedIds,
  selectedNodeId,
  onToggle,
  onSelect,
}: {
  node: LibraryNode
  depth: number
  childrenMap: Record<string, LibraryNode[]>
  expandedIds: string[]
  selectedNodeId: string | null
  onToggle: (nodeId: string) => void
  onSelect: (nodeId: string) => void
}) {
  const expanded = expandedIds.includes(node.id)
  const children = childrenMap[node.id] ?? []
  const selected = selectedNodeId === node.id

  return (
    <div>
      <div
        className={[
          'flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm',
          selected
            ? 'bg-[var(--color-accent)] text-white'
            : 'text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]',
        ].join(' ')}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          className="h-6 w-6 shrink-0 rounded text-xs opacity-80"
          onClick={() => onToggle(node.id)}
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => onSelect(node.id)}
        >
          {node.title}
          {typeof node.count === 'number' ? (
            <span className="ml-1 opacity-70">({node.count})</span>
          ) : null}
        </button>
      </div>
      {expanded
        ? children.map((child) => (
            <TreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              expandedIds={expandedIds}
              selectedNodeId={selectedNodeId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  )
}

export function LibraryTree({
  roots,
  childrenMap,
  expandedIds,
  selectedNodeId,
  onToggle,
  onSelect,
}: LibraryTreeProps) {
  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      {roots.map((node) => (
        <TreeNodeView
          key={node.id}
          node={node}
          depth={0}
          childrenMap={childrenMap}
          expandedIds={expandedIds}
          selectedNodeId={selectedNodeId}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
