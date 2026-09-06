import { useCallback, useEffect, useState } from 'react'
import {
  enablePlugin,
  isProviderConnectedStatus,
  pluginRegistry,
  type AuthenticationProvider,
  type ProviderStatusAction,
  type ProviderStatusActionId,
  type ProviderStatusDescriptor,
  type ProviderStatusSeverity,
} from '../sdk'
import { getPlayerManager } from '../services/audioPlayer'
import { sourceManager } from '../sources'

type ProviderAuthPanelProps = {
  pluginId: string
  /** Fallback title, если дескриптор ещё не загружен. */
  name: string
}

type PanelState = {
  descriptor: ProviderStatusDescriptor | null
  busy: boolean
  actionError: string | null
}

function severityClass(severity: ProviderStatusSeverity): string {
  switch (severity) {
    case 'error':
      return 'text-rose-600 dark:text-rose-400'
    case 'warning':
      return 'text-amber-700 dark:text-amber-400'
    case 'success':
      return 'text-[var(--color-accent)]'
    case 'info':
    case 'neutral':
    default:
      return 'text-[var(--color-muted)]'
  }
}

function actionButtonClass(variant: ProviderStatusAction['variant']): string {
  switch (variant) {
    case 'primary':
      return 'rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40'
    case 'danger':
      return 'rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-medium text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400'
    case 'secondary':
    default:
      return 'rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40'
  }
}

async function resolveDescriptor(
  auth: AuthenticationProvider,
  fallbackTitle: string,
): Promise<ProviderStatusDescriptor> {
  if (auth.getStatus) {
    return auth.getStatus()
  }

  const authenticated = await auth.isAuthenticated()
  const profile = authenticated
    ? ((await auth.getProfile?.()) ?? null)
    : null
  const lastSyncedAt = authenticated
    ? ((await auth.getLastSyncedAt?.()) ?? null)
    : null

  if (authenticated) {
    const details =
      lastSyncedAt != null
        ? [{ label: 'Sync', value: new Date(lastSyncedAt).toLocaleString() }]
        : undefined
    return {
      status: 'connected_premium',
      title: fallbackTitle,
      description: profile?.displayName
        ? `Connected · ${profile.displayName}`
        : 'Connected',
      severity: 'success',
      actions: [
        ...(auth.syncLibrary
          ? [
              {
                id: 'sync' as const,
                label: 'Sync library',
                variant: 'secondary' as const,
              },
            ]
          : []),
        { id: 'logout', label: 'Disconnect', variant: 'danger' },
      ],
      details,
    }
  }

  return {
    status: 'disconnected',
    title: fallbackTitle,
    description: 'Not connected',
    severity: 'neutral',
    actions: [{ id: 'login', label: 'Connect', variant: 'primary' }],
  }
}

/**
 * Универсальная панель источника.
 * Рендерит только поля ProviderStatusDescriptor — без текстов и спец-веток.
 */
export function ProviderAuthPanel({ pluginId, name }: ProviderAuthPanelProps) {
  const [state, setState] = useState<PanelState>({
    descriptor: null,
    busy: false,
    actionError: null,
  })

  const resolveAuth = useCallback((): AuthenticationProvider | null => {
    return pluginRegistry.getAuthenticationProvider(pluginId)
  }, [pluginId])

  const refresh = useCallback(async () => {
    const auth = resolveAuth()
    if (!auth) {
      setState((prev) => ({
        ...prev,
        descriptor: {
          status: 'error',
          title: name,
          description: 'Authentication unavailable',
          severity: 'error',
          actions: [],
        },
      }))
      return
    }

    try {
      try {
        await sourceManager.getAdapter(pluginId).initialize()
      } catch {
        // Ошибки init отражает getStatus провайдера.
      }

      const descriptor = await resolveDescriptor(auth, name)

      if (
        isProviderConnectedStatus(descriptor.status) &&
        !pluginRegistry.isEnabled(pluginId)
      ) {
        enablePlugin(pluginId)
      }

      if (!isProviderConnectedStatus(descriptor.status)) {
        getPlayerManager().releaseDevice(pluginId)
      }

      setState((prev) => ({
        ...prev,
        descriptor,
        actionError: null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        descriptor: {
          status: 'error',
          title: name,
          description:
            error instanceof Error ? error.message : 'Provider status error',
          severity: 'error',
          actions: [],
        },
      }))
    }
  }, [name, pluginId, resolveAuth])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAction = async (actionId: ProviderStatusActionId) => {
    setState((prev) => ({ ...prev, busy: true, actionError: null }))
    try {
      const auth = resolveAuth()
      if (!auth) {
        throw new Error('Authentication unavailable')
      }

      switch (actionId) {
        case 'login':
          if (!pluginRegistry.isEnabled(pluginId)) {
            enablePlugin(pluginId)
          }
          await auth.login()
          break
        case 'logout':
          await auth.logout()
          getPlayerManager().releaseDevice(pluginId)
          break
        case 'sync': {
          const syncAction = state.descriptor?.actions.find(
            (item) => item.id === 'sync',
          )
          if (syncAction?.disabled) {
            break
          }
          if (!auth.syncLibrary) {
            throw new Error('Sync is not supported')
          }
          await auth.syncLibrary()
          break
        }
        case 'reconnect_device':
          await getPlayerManager().reconnectDevice(pluginId)
          break
        default:
          break
      }

      await refresh()
    } catch (error) {
      setState((prev) => ({
        ...prev,
        busy: false,
        actionError: error instanceof Error ? error.message : String(error),
      }))
      return
    }
    setState((prev) => ({ ...prev, busy: false }))
  }

  const descriptor = state.descriptor

  if (!descriptor) {
    return (
      <section
        className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        aria-busy="true"
      >
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          {name}
        </h2>
      </section>
    )
  }

  const setup = descriptor.setup

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          {descriptor.title}
        </h2>
        <p className={`text-sm ${severityClass(descriptor.severity)}`}>
          {descriptor.description}
        </p>
      </div>

      {setup ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              {setup.title}
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              {setup.description}
            </p>
          </div>
          {setup.steps.length > 0 ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-muted)]">
              {setup.steps.map((step) => (
                <li key={step.title}>
                  <span className="text-[var(--color-fg)]">{step.title}</span>
                  {step.description ? (
                    <p className="mt-0.5 text-[var(--color-muted)]">
                      {step.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {setup.documentationUrl ? (
            <a
              href={setup.documentationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)]"
            >
              {setup.documentationLabel ?? setup.documentationUrl}
            </a>
          ) : null}
        </div>
      ) : null}

      {descriptor.details && descriptor.details.length > 0 ? (
        <ul className="space-y-1 text-xs text-[var(--color-muted)]">
          {descriptor.details.map((detail) => (
            <li key={detail.label}>
              {detail.label}: {detail.value}
            </li>
          ))}
        </ul>
      ) : null}

      {state.actionError ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {state.actionError}
        </p>
      ) : null}

      {descriptor.actions.length > 0 ? (
        <div className="flex flex-wrap items-start gap-3">
          {descriptor.actions.map((action) => (
            <div key={action.id} className="flex max-w-full flex-col gap-1">
              <button
                type="button"
                className={actionButtonClass(action.variant)}
                disabled={state.busy || action.disabled}
                onClick={() => {
                  void runAction(action.id)
                }}
              >
                {action.label}
              </button>
              {action.disabled && action.hint ? (
                <p className="text-xs text-[var(--color-muted)]">{action.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
