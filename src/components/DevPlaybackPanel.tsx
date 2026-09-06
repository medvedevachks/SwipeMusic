import { useCallback, useEffect, useState } from 'react'
import {
  getPlaybackResolver,
  type PlaybackCandidate,
} from '../services/playbackResolver'
import { usePlayerStore } from '../store/playerStore'

/**
 * Dev-only: принудительный выбор PlaybackCandidate для отладки.
 */
export function DevPlaybackPanel() {
  const [candidates, setCandidates] = useState<PlaybackCandidate[]>([])
  const [overrideId, setOverrideId] = useState<string>('')
  const currentTrack = usePlayerStore((state) => state.currentTrack)
  const playTrack = usePlayerStore((state) => state.playTrack)

  const refresh = useCallback(() => {
    const resolver = getPlaybackResolver()
    setCandidates(resolver.getLastCandidates())
    setOverrideId(resolver.getDevOverride()?.candidateId ?? '')
  }, [])

  useEffect(() => {
    return getPlaybackResolver().subscribe(() => {
      refresh()
    })
  }, [refresh])

  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <section className="space-y-2 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-xs">
      <p className="font-medium text-[var(--color-fg)]">
        Dev · PlaybackResolver
      </p>
      <label className="flex flex-col gap-1 text-[var(--color-muted)]">
        Force candidate
        <select
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[var(--color-fg)]"
          value={overrideId}
          onChange={(event) => {
            const value = event.target.value
            setOverrideId(value)
            getPlaybackResolver().setDevOverride(
              value ? { candidateId: value } : null,
            )
          }}
        >
          <option value="">Auto (best available)</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id} disabled={!item.available}>
              {item.id}
              {item.available ? '' : ' (unavailable)'}
              {item.label ? ` · ${item.label}` : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[var(--color-fg)] disabled:opacity-40"
        disabled={!currentTrack}
        onClick={() => {
          if (!currentTrack) {
            return
          }
          void playTrack(currentTrack).then(() => refresh())
        }}
      >
        Replay current with override
      </button>
      {candidates.length > 0 ? (
        <ul className="space-y-1 text-[var(--color-muted)]">
          {candidates.map((item) => (
            <li key={item.id}>
              {item.available ? '✓' : '✗'} {item.id} [{item.type}] p=
              {item.priority}
              {item.reason ? ` — ${item.reason}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[var(--color-muted)]">
          Сыграйте трек, чтобы увидеть кандидатов
        </p>
      )}
    </section>
  )
}
