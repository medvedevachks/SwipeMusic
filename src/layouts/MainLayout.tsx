import { Outlet } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import BottomNav from '../components/BottomNav'
import BottomPlayer from '../components/player/BottomPlayer'
import PlaybackFallbackHost from '../components/player/PlaybackFallbackHost'
import { useGlobalPlayerHotkeys } from '../hooks/useGlobalPlayerHotkeys'
import { usePlayerQueueBootstrap } from '../hooks/usePlayerQueueBootstrap'
import { useLibraryPersistenceStore } from '../services/libraryPersistence/statusStore'

export default function MainLayout() {
  usePlayerQueueBootstrap()
  useGlobalPlayerHotkeys()

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[11.5rem] pt-5 sm:px-6 sm:pt-6">
        <LibraryStatus />
        <LibraryOutlet />
      </main>
      <div
        className="fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <PlaybackFallbackHost />
        <BottomPlayer />
        <BottomNav />
      </div>
    </div>
  )
}

function LibraryOutlet() {
  const status = useLibraryPersistenceStore((state) => state.status)
  if (status === 'ready' || status === 'saving' || status === 'error') {
    return <Outlet />
  }
  return null
}

function LibraryStatus() {
  const status = useLibraryPersistenceStore((state) => state.status)
  const message = useLibraryPersistenceStore((state) => state.message)

  if (status === 'idle' || status === 'loading') {
    return (
      <p className="mb-4 text-sm text-[var(--color-muted)]">Загрузка библиотеки…</p>
    )
  }

  if (status === 'error' && message) {
    return (
      <p className="mb-4 text-sm text-rose-600" role="alert">
        {message}
      </p>
    )
  }

  return null
}
