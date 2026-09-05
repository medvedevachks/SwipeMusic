import type { ReactNode } from 'react'

type BottomSheetProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
}: BottomSheetProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[82vh] w-full max-w-2xl flex-col rounded-t-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_-20px_50px_-28px_rgba(20,33,43,0.45)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="relative border-b border-[var(--color-border)] px-4 pb-3 pt-4">
          <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--color-border)]" />
          <div className="flex items-center justify-between gap-3 pt-2">
            <h2 className="text-base font-semibold text-[var(--color-fg)]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Закрыть
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  )
}
