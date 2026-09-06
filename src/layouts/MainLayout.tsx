import { Outlet } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import BottomNav from '../components/BottomNav'
import { usePlayerQueueBootstrap } from '../hooks/usePlayerQueueBootstrap'

export default function MainLayout() {
  usePlayerQueueBootstrap()

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-5 sm:px-6 sm:pt-6">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
