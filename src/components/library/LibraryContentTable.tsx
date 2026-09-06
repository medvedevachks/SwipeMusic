import type { LibraryTrackRowModel } from '../../store/libraryUiStore'
import { formatPlaybackTime } from '../../utils/formatTime'

type LibraryContentTableProps = {
  rows: LibraryTrackRowModel[]
  selectedIds: string[]
  onToggle: (trackId: string, shiftKey: boolean) => void
  onPlay: (trackId: string) => void
  onOpenActions: (trackId: string) => void
  providerLabelBySourceId: (sourceId: string) => string
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—'
  }
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return value
  }
}

export function LibraryContentTable({
  rows,
  selectedIds,
  onToggle,
  onPlay,
  onOpenActions,
  providerLabelBySourceId,
}: LibraryContentTableProps) {
  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-[var(--color-muted)]">
        Нет треков в этом узле
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th className="px-2 py-2"> </th>
            <th className="px-2 py-2">#</th>
            <th className="px-2 py-2">Название</th>
            <th className="px-2 py-2">Исполнитель</th>
            <th className="px-2 py-2">Альбом</th>
            <th className="px-2 py-2">Источник</th>
            <th className="px-2 py-2">Категория</th>
            <th className="px-2 py-2">Длительность</th>
            <th className="px-2 py-2">Добавлен</th>
            <th className="px-2 py-2">Прослушиваний</th>
            <th className="px-2 py-2">Последнее</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = selectedIds.includes(row.track.id)
            const durationSec =
              row.track.durationMs != null
                ? Math.round(row.track.durationMs / 1000)
                : 0
            return (
              <tr
                key={row.track.id}
                className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-hover)]"
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => {
                      event.preventDefault()
                      onToggle(row.track.id, event.shiftKey)
                    }}
                    onChange={() => undefined}
                    aria-label={`Выбрать ${row.track.title}`}
                  />
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {index + 1}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                    onClick={() => onOpenActions(row.track.id)}
                  >
                    {row.track.title}
                  </button>
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {row.track.artist}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {row.track.album ?? '—'}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {providerLabelBySourceId(row.track.sourceId)}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {row.meta.categoryIds.length > 0
                    ? row.meta.categoryIds.length
                    : '—'}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {durationSec > 0 ? formatPlaybackTime(durationSec) : '—'}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {formatDate(row.meta.addedAt)}
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  <button type="button" onClick={() => onPlay(row.track.id)}>
                    {row.meta.playCount}
                  </button>
                </td>
                <td className="px-2 py-2 text-[var(--color-muted)]">
                  {formatDate(row.meta.lastPlayedAt)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
