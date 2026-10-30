import { Link } from 'react-router-dom'
import { CatalogList } from '../components/catalog/CatalogList'
import { LibrarySystemFolders } from '../components/catalog/LibrarySystemFolders'

/**
 * Корень библиотеки: только компактные папки и каталоги.
 * Длинные списки источников — /library/browse.
 */
export default function Library() {
  return (
    <section className="space-y-4 pb-8">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          Библиотека
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Организованная музыка: папки и каталоги
        </p>
      </div>

      <LibrarySystemFolders />
      <CatalogList />

      <section
        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4"
        aria-label="Источники"
      >
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          Источники
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Каталог подключённых сервисов и локальных файлов — отдельно от
          организованной библиотеки.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/library/browse"
            className="inline-flex min-h-11 items-center rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          >
            Открыть источники
          </Link>
          <Link
            to="/sources"
            className="inline-flex min-h-11 items-center rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-fg)]"
          >
            Управление подключением
          </Link>
        </div>
      </section>
    </section>
  )
}
