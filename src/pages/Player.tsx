import { Link } from 'react-router-dom'
import { musicSourceRegistry } from '../sources'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'

export default function Player() {
  const currentTrackId = usePlayerStore((state) => state.currentTrackId)
  const sourceTracks = useCollectionStore((state) => state.sourceTracks)
  const track = sourceTracks.find((item) => item.id === currentTrackId)

  if (!track) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Плеер</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Выберите запись в медиатеке. Встроенное воспроизведение Zaycev.net не подключено.
        </p>
        <Link className="text-sm text-[var(--color-accent)]" to="/library">
          К медиатеке
        </Link>
      </section>
    )
  }

  const source = musicSourceRegistry.has(track.sourceId)
    ? musicSourceRegistry.get(track.sourceId)
    : null
  const canPlay = source?.canPlay(track) ?? false
  const canOpen = Boolean(track.playback.externalOpen && track.pageUrl && source?.openExternal)

  return (
    <section className="space-y-5">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Плеер</h1>
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-lg font-medium">{track.title}</p>
        <p className="text-sm text-[var(--color-muted)]">{track.artist}</p>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Источник: {source?.label ?? track.sourceId}
        </p>
      </div>

      {canPlay ? (
        <p className="text-sm text-[var(--color-muted)]">Воспроизведение этого источника подключено.</p>
      ) : null}

      {canOpen ? (
        <button
          type="button"
          className="h-11 w-full rounded-xl bg-[var(--color-accent)] text-sm font-medium text-white"
          onClick={() => source?.openExternal?.(track)}
        >
          Открыть в Zaycev.net
        </button>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          Встроенная кнопка Play скрыта: у источника нет capability playback.
        </p>
      )}
    </section>
  )
}
