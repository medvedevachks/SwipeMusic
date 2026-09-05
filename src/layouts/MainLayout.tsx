import { Outlet } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import BottomNav from '../components/BottomNav'

export default function MainLayout() {
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
