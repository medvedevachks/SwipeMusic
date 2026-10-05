import type { FallbackUxAction, FallbackUxModel } from '../../services/runtimeFallback/fallbackUxModel.ts'
import BottomSheet from '../BottomSheet'

type PlaybackAlternativesSheetProps = {
  model: FallbackUxModel
  onAction: (action: FallbackUxAction) => void
}

/**
 * Показывает уже собранные строки альтернатив.
 * Имена провайдеров приходят в модели, здесь нет веток по sourceId.
 */
export default function PlaybackAlternativesSheet({
  model,
  onAction,
}: PlaybackAlternativesSheetProps) {
  const open = model.kind === 'confirmation' || model.kind === 'terminal'
  return (
    <BottomSheet
      open={open}
      title={model.title ?? 'Источники'}
      onClose={() => onAction({ type: 'dismiss' })}
    >
      {model.body ? <p className="mb-3 text-sm text-[var(--color-fg)]">{model.body}</p> : null}
      {model.rows.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {model.rows.map((row) => (
            <li
              key={row.sourceTrackKey}
              className="rounded-xl border border-[var(--color-border)] px-3 py-2"
            >
              <p className="text-sm font-medium text-[var(--color-fg)]">{row.providerLabel}</p>
              <p className="text-xs text-[var(--color-muted)]">
                {row.tone === 'failed' ? '✕ ' : ''}
                {row.statusText}
              </p>
              {row.detail !== row.statusText ? (
                <p className="mt-1 text-xs text-[var(--color-muted)]">{row.detail}</p>
              ) : null}
              {row.actions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.actions.map((action) => (
                    <ActionButton
                      key={actionKey(action)}
                      action={action}
                      dismissLabel="Закрыть"
                      onAction={onAction}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {model.primaryActions.map((action) => (
          <ActionButton
            key={actionKey(action)}
            action={action}
            dismissLabel={model.kind === 'confirmation' ? 'Отмена' : 'Закрыть'}
            onAction={onAction}
          />
        ))}
      </div>
    </BottomSheet>
  )
}

function ActionButton({
  action,
  dismissLabel,
  onAction,
}: {
  action: FallbackUxAction
  dismissLabel: string
  onAction: (action: FallbackUxAction) => void
}) {
  const primary = action.type === 'confirm-play' || action.type === 'play' || action.type === 'retry-playback'
  return (
    <button
      type="button"
      className={[
        'min-h-11 rounded-xl px-4 text-sm',
        primary
          ? 'bg-[var(--color-accent)] text-white'
          : 'border border-[var(--color-border)] text-[var(--color-fg)]',
      ].join(' ')}
      onClick={() => onAction(action)}
    >
      {actionLabel(action, dismissLabel)}
    </button>
  )
}

function actionLabel(action: FallbackUxAction, dismissLabel: string): string {
  switch (action.type) {
    case 'confirm-play':
    case 'play':
      return `Воспроизвести из ${action.providerLabel}`
    case 'sources':
      return 'Перейти к источникам'
    case 'recheck':
      return 'Проверить снова'
    case 'retry-playback':
      return 'Повторить'
    case 'dismiss':
      return dismissLabel
    default:
      return 'Закрыть'
  }
}

function actionKey(action: FallbackUxAction): string {
  switch (action.type) {
    case 'confirm-play':
    case 'play':
    case 'recheck':
      return `${action.type}:${action.sourceTrackKey}`
    default:
      return action.type
  }
}
