import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CAPABILITY_LABELS, hasCapability, listMusicSources } from '../sources'
import { searchMusic } from '../services/searchMusic'
import type { MusicSourceCapability } from '../sources/types'
import type { Track } from '../types/track'
import { useCollectionStore } from '../store/collectionStore'
import { usePlayerStore } from '../store/playerStore'

const VISIBLE_CAPABILITIES: MusicSourceCapability[] = [
  'search',
  'metadata',
  'libraryImport',
  'librarySync',
  'playback',
  'externalOpen',
]

export default function Search() {
  const navigate = useNavigate()
  const sources = listMusicSources()
  const sourceTracks = useCollectionStore((state) => state.sourceTracks)
  const setCurrentTrackId = usePlayerStore((state) => state.setCurrentTrackId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const needle = query.trim()
      if (!needle) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      void searchMusic(needle, sourceTracks)
        .then(setResults)
        .finally(() => setSearching(false))
    }, 200)
    return () => window.clearTimeout(handle)
  }, [query, sourceTracks])

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Поиск</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Ищет в демо-ленте и в уже сохранённых записях. Каталоги Zaycev.net и Яндекс Музыки через
          официальный API недоступны — туда можно сохранить ссылку.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-muted)]">Название или исполнитель</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Например, Midnight Drive"
          className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
        />
      </label>

      {query.trim() ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Результаты</h2>
          {searching ? (
            <p className="text-sm text-[var(--color-muted)]">Ищем…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">Ничего не найдено в локальной библиотеке.</p>
          ) : (
            <ul className="space-y-3">
              {results.map((track) => (
                <li
                  key={track.id}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                >
                  <p className="font-medium">{track.title}</p>
                  <p className="text-sm text-[var(--color-muted)]">{track.artist}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">{track.sourceId}</p>
                  {track.pageUrl ? (
                    <button
                      type="button"
                      className="mt-3 h-11 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white"
                      onClick={() => {
                        setCurrentTrackId(track.id)
                        navigate('/player')
                      }}
                    >
                      Открыть карточку
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div>
        <h2 className="text-base font-semibold">Источники</h2>
        <ul className="mt-3 space-y-3">
          {sources.map((source) => {
            const enabled = VISIBLE_CAPABILITIES.filter((item) =>
              hasCapability(source.capabilities, item),
            )
            return (
              <li key={source.id}>
                <Link
                  to={`/search/${source.id}`}
                  className="block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                >
                  <p className="text-base font-medium">{source.label}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{source.connectionNote}</p>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    {enabled.length > 0
                      ? enabled.map((item) => CAPABILITY_LABELS[item]).join(' · ')
                      : 'Нет сетевых возможностей'}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
