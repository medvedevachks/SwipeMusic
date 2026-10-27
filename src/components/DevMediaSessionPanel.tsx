import { useEffect, useState } from 'react'
import {
  clearDevMediaSessionLog,
  getDevMediaSessionLog,
  subscribeDevMediaSessionLog,
  type DevMediaSessionEntry,
} from '../services/audioPlayer/devMediaSessionLog.ts'
import { getMediaSessionStatus } from '../services/audioPlayer/mediaSession.ts'

/** Dev-only диагностика системных медиакоманд. В production не показывается. */
export function DevMediaSessionPanel() {
  const [entries, setEntries] = useState<DevMediaSessionEntry[]>(() => getDevMediaSessionLog())
  const [revision, setRevision] = useState(0)

  useEffect(() => subscribeDevMediaSessionLog((next) => {
    setEntries(next)
    setRevision((value) => value + 1)
  }), [])

  if (!import.meta.env.DEV) {
    return null
  }

  const status = getMediaSessionStatus()
  const track = status.title
    ? `${status.title}${status.artist ? ` — ${status.artist}` : ''}`
    : 'нет'

  return (
    <section className="space-y-2 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-[var(--color-fg)]">Dev · Media Session</p>
        <button
          type="button"
          className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-[var(--color-muted)]"
          onClick={() => clearDevMediaSessionLog()}
        >
          Clear
        </button>
      </div>
      <p className="text-[var(--color-muted)]" data-revision={revision}>
        {status.supported
          ? `API доступен · ${status.playbackState} · ${track}`
          : 'Media Session API недоступен. Экранные кнопки плеера работают как раньше.'}
      </p>
      <p className="text-[var(--color-muted)]">
        Команды: {status.actions.length > 0 ? status.actions.join(', ') : 'нет'}
      </p>
      {entries.length === 0 ? (
        <p className="text-[var(--color-muted)]">
          Системных команд ещё не было. Нажмите Play на экране — состояние обновится здесь.
        </p>
      ) : (
        <ol className="space-y-1 font-mono text-[var(--color-fg)]">
          {entries.slice(-12).map((entry) => (
            <li key={entry.id}>
              {entry.message}
              {entry.detail ? ` · ${entry.detail}` : ''}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
