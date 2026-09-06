import { usePlaybackResolution } from '../hooks/usePlaybackResolution'

/**
 * Бейдж режима воспроизведения (Preview / Full).
 * Не знает Spotify — только candidate.type / label из Resolver.
 */
export function PlaybackModeBadge() {
  const resolution = usePlaybackResolution()
  if (!resolution) {
    return null
  }

  if (resolution.candidate.type !== 'preview') {
    return null
  }

  const label = resolution.candidate.label ?? 'Preview'

  return (
    <span
      className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]"
      title={label}
    >
      {label}
    </span>
  )
}
