import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CAPABILITY_LABELS, hasCapability, musicSourceRegistry } from '../sources'
import { bootstrapMusicSources } from '../sources'
import type { MusicSourceCapability } from '../sources/types'
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

export default function SourceDetail() {
  bootstrapMusicSources()
  const { sourceId = '' } = useParams()
  const navigate = useNavigate()
  const source = musicSourceRegistry.has(sourceId)
    ? musicSourceRegistry.get(sourceId)
    : null
  const categories = useCollectionStore((state) => state.categories)
  const addSourceTrackToCatalog = useCollectionStore(
    (state) => state.addSourceTrackToCatalog,
  )
  const setCurrentTrackId = usePlayerStore((state) => state.setCurrentTrackId)

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (!source) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Источник не найден</h1>
        <Link className="text-sm text-[var(--color-accent)]" to="/search">
          К списку источников
        </Link>
      </section>
    )
  }

  const enabled = VISIBLE_CAPABILITIES.filter((item) =>
    hasCapability(source.capabilities, item),
  )

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!source?.createManualEntry) {
      setError('Этот источник не поддерживает ручное добавление ссылок.')
      return
    }
    if (!categoryId) {
      setError('Выберите каталог')
      return
    }
    try {
      const track = source.createManualEntry({ title, artist, pageUrl })
      addSourceTrackToCatalog(track, categoryId)
      setTitle('')
      setArtist('')
      setPageUrl('')
      setMessage('Запись добавлена в каталог и медиатеку')
      setCurrentTrackId(track.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    }
  }

  return (
    <section className="space-y-5">
      <Link className="text-sm text-[var(--color-accent)]" to="/search">
        Все источники
      </Link>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{source.label}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{source.connectionNote}</p>
      </div>

      <ul className="space-y-1 text-sm">
        {VISIBLE_CAPABILITIES.map((item) => (
          <li key={item} className="text-[var(--color-muted)]">
            {enabled.includes(item) ? '●' : '○'} {CAPABILITY_LABELS[item]}
            {item === 'playback' && !enabled.includes(item)
              ? ' — кнопка Play скрыта'
              : null}
          </li>
        ))}
      </ul>

      {source.createManualEntry ? (
        <form className="space-y-3" onSubmit={onSubmit}>
          <h2 className="text-base font-semibold">Добавить ссылку</h2>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">Название</span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">Исполнитель</span>
            <input
              required
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">
              HTTPS-ссылка на страницу
            </span>
            <input
              required
              type="url"
              value={pageUrl}
              onChange={(event) => setPageUrl(event.target.value)}
              placeholder="https://zaycev.net/..."
              className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--color-muted)]">Каталог</span>
            <select
              required
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {message ? <p className="text-sm text-[var(--color-accent)]">{message}</p> : null}
          <button
            type="submit"
            className="h-11 w-full rounded-xl bg-[var(--color-accent)] text-sm font-medium text-white"
          >
            Сохранить в каталог
          </button>
        </form>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          Ручное добавление ссылок для этого источника не предусмотрено.
        </p>
      )}

      {source.id === 'mock' ? (
        <button
          type="button"
          className="h-11 w-full rounded-xl border border-[var(--color-border)] text-sm"
          onClick={() => navigate('/')}
        >
          Открыть демо-ленту
        </button>
      ) : null}
    </section>
  )
}
