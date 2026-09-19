import { Link } from 'react-router-dom'
import { CAPABILITY_LABELS, hasCapability, listMusicSources } from '../sources'
import type { MusicSourceCapability } from '../sources/types'

const VISIBLE_CAPABILITIES: MusicSourceCapability[] = [
  'search',
  'metadata',
  'libraryImport',
  'librarySync',
  'playback',
  'externalOpen',
]

export default function Search() {
  const sources = listMusicSources()

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Источники</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Одна медиатека для записей из разных сервисов. Свайпы на главной остаются способом
          сортировки.
        </p>
      </div>

      <ul className="space-y-3">
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
    </section>
  )
}
