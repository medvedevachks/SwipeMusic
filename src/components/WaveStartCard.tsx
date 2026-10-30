import { Link } from 'react-router-dom'
import { PlayIcon } from './icons'

type WaveStartCardProps = {
  pending: boolean
  message: string | null
  canStart: boolean
  showSourcesLink?: boolean
  onStart: () => void
}

export default function WaveStartCard({
  pending,
  message,
  canStart,
  showSourcesLink = false,
  onStart,
}: WaveStartCardProps) {
  const retry = Boolean(message) && canStart && !pending

  return (
    <div className="swipe-deck" data-testid="wave-start-card">
      {/* Та же центральная ячейка stage, что у SwipeDeck — иначе grid сжимает карточку в боковую колонку. */}
      <div className="swipe-stage-slot">
        <div className="swipe-stage">
          <article className="absolute inset-0">
            <div className="deck-card flex h-full flex-col overflow-hidden rounded-[1.7rem]">
              <div className="deck-cover bg-[var(--color-accent)]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/35" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_45%)]" />
                {canStart ? (
                  <button
                    type="button"
                    className="deck-key deck-key-primary deck-orb"
                    aria-label={retry ? 'Повторить' : 'Слушать'}
                    aria-busy={pending}
                    disabled={pending}
                    onClick={onStart}
                  >
                    {pending ? (
                      <span className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                    ) : (
                      <PlayIcon className="translate-x-0.5" />
                    )}
                  </button>
                ) : null}
              </div>
              <div className="space-y-1 px-5 py-4">
                <h2 className="truncate text-xl font-semibold tracking-tight text-[var(--color-fg)]">
                  Моя волна
                </h2>
                <p className="text-sm text-[var(--color-muted)]" role={retry ? 'alert' : undefined}>
                  {pending
                    ? 'Подбираем музыку…'
                    : (message ?? 'Музыка на основе вашего избранного')}
                </p>
                {showSourcesLink ? (
                  <Link
                    to="/sources"
                    className="inline-flex text-sm font-medium text-[var(--color-accent)]"
                  >
                    Открыть источники
                  </Link>
                ) : null}
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}
