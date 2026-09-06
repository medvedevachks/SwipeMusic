import { useLocalMusicStore } from '../store/localMusicStore'
import type { LocalAccessState } from '../sources/adapters/local-folder'

function accessLabel(state: LocalAccessState): string {
  switch (state) {
    case 'granted':
      return 'Разрешён'
    case 'prompt':
      return 'Требуется повторное разрешение'
    case 'denied':
      return 'Доступ запрещён'
    case 'unsupported':
      return 'Браузер не поддерживает'
    case 'idle':
      return 'Папка не выбрана'
  }
}

function formatScanDate(timestamp: number | null): string {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleString()
}

export function LocalMusicPanel() {
  const stats = useLocalMusicStore((state) => state.stats)
  const progress = useLocalMusicStore((state) => state.progress)
  const isBusy = useLocalMusicStore((state) => state.isBusy)
  const error = useLocalMusicStore((state) => state.error)
  const connectFolder = useLocalMusicStore((state) => state.connectFolder)
  const requestAccess = useLocalMusicStore((state) => state.requestAccess)
  const rescan = useLocalMusicStore((state) => state.rescan)
  const disconnect = useLocalMusicStore((state) => state.disconnect)

  const hasFolder = Boolean(stats.folderName)
  const needsPermission =
    stats.accessState === 'prompt' || stats.accessState === 'denied'
  const isScanning =
    progress.phase === 'counting' || progress.phase === 'scanning'

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          Local Music
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Папка на устройстве через File System Access API.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={isBusy || stats.accessState === 'unsupported'}
          onClick={() => {
            void connectFolder()
          }}
        >
          Выбрать папку
        </button>

        {needsPermission && hasFolder ? (
          <button
            type="button"
            className="rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40"
            disabled={isBusy}
            onClick={() => {
              void requestAccess()
            }}
          >
            Разрешить доступ
          </button>
        ) : null}

        <button
          type="button"
          className="rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-fg)] disabled:opacity-40"
          disabled={isBusy || !hasFolder || needsPermission}
          onClick={() => {
            void rescan()
          }}
        >
          Пересканировать
        </button>

        <button
          type="button"
          className="rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-medium text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
          disabled={isBusy || !hasFolder}
          onClick={() => {
            void disconnect()
          }}
        >
          Отключить библиотеку
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--color-muted)]">Папка</dt>
          <dd className="font-medium text-[var(--color-fg)]">
            {stats.folderName ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Доступ</dt>
          <dd className="font-medium text-[var(--color-fg)]">
            {accessLabel(stats.accessState)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Треков</dt>
          <dd className="font-medium text-[var(--color-fg)]">
            {stats.trackCount}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">Подпапок</dt>
          <dd className="font-medium text-[var(--color-fg)]">
            {stats.subdirectoryCount}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--color-muted)]">Последнее сканирование</dt>
          <dd className="font-medium text-[var(--color-fg)]">
            {formatScanDate(stats.lastScanAt)}
          </dd>
        </div>
      </dl>

      {isScanning || progress.phase === 'done' || progress.phase === 'error' ? (
        <div
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]"
          aria-live="polite"
        >
          {progress.message ??
            (isScanning
              ? `Сканирование… ${progress.processedFiles} из ${progress.totalFiles} файлов`
              : null)}
          {progress.phase === 'done' ? (
            <span className="mt-1 block text-[var(--color-muted)]">
              Найдено треков: {progress.foundTracks}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      ) : null}

      {stats.accessState === 'unsupported' ? (
        <p className="text-sm text-[var(--color-muted)]">
          Нужен Chromium-браузер с поддержкой File System Access API
          (Chrome / Edge).
        </p>
      ) : null}
    </section>
  )
}
