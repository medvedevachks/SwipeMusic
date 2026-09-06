import type { Category } from '../../types/category'
import type { LibraryEntry } from '../../types/trackMeta'

type TrackActionSheetProps = {
  entry: LibraryEntry | null
  open: boolean
  categories: Category[]
  onClose: () => void
  onPlay: () => void
  onPlayNext: () => void
  onAddToQueue: () => void
  onShuffle: () => void
  onOpenInSwipes: () => void
  onToggleLike: () => void
  onToggleFavorite: () => void
  onAssignCategory: (categoryId: string) => void
  onReveal: () => void
  onRefresh: () => void
  onShowInfo: () => void
  onCopyInfo: () => void
}

export function TrackActionSheet({
  entry,
  open,
  categories,
  onClose,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onShuffle,
  onOpenInSwipes,
  onToggleLike,
  onToggleFavorite,
  onAssignCategory,
  onReveal,
  onRefresh,
  onShowInfo,
  onCopyInfo,
}: TrackActionSheetProps) {
  if (!open || !entry) {
    return null
  }

  const actions = [
    { label: '▶ Play', onClick: onPlay },
    { label: '⏭ Play Next', onClick: onPlayNext },
    { label: '➕ Add to Queue', onClick: onAddToQueue },
    { label: '🔀 Shuffle', onClick: onShuffle },
    { label: '➡ Открыть в свайпах', onClick: onOpenInSwipes },
    {
      label: entry.meta.liked ? '💔 Unlike' : '❤️ Like',
      onClick: onToggleLike,
    },
    {
      label: entry.meta.favorite ? '☆ Убрать из избранного' : '⭐ Favorite',
      onClick: onToggleFavorite,
    },
    { label: '📂 Reveal', onClick: onReveal },
    { label: '🔄 Refresh', onClick: onRefresh },
    { label: '📝 Info', onClick: onShowInfo },
    { label: '📋 Copy', onClick: onCopyInfo },
  ]

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl">
        <p className="font-display text-lg font-semibold text-[var(--color-fg)]">
          {entry.track.title}
        </p>
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          {entry.track.artist}
        </p>
        <div className="flex flex-col gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-left text-sm text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]"
              onClick={() => {
                action.onClick()
                onClose()
              }}
            >
              {action.label}
            </button>
          ))}
          {categories.length > 0 ? (
            <div className="mt-1 space-y-1 border-t border-[var(--color-border)] pt-2">
              <p className="px-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
                Assign Category
              </p>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-hover)]"
                  onClick={() => {
                    onAssignCategory(category.id)
                    onClose()
                  }}
                >
                  {category.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
