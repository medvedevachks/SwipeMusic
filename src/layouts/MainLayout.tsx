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
    <div className="app-shell bg-[var(--color-bg)]">
      <AppHeader />
      <main className="app-main">
        <div className="app-main-frame">
          <LibraryStatus />
          <LibraryOutlet />
        </div>
      </main>
      <div className="app-dock">
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
