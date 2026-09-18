import { Outlet } from 'react-router-dom'
import AppHeader from '../components/AppHeader'

export default function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
