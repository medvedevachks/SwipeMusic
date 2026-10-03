import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const restoreSession = useAuthStore((state) => state.restoreSession)

  useEffect(() => {
    void restoreSession()
  }, [restoreSession])

  if (status === 'loading') {
    return (
      <div className="flex min-h-svh items-center justify-center px-4">
        <p className="text-sm text-[var(--color-muted)]">Проверка сессии…</p>
      </div>
    )
  }

  return children
}

export function RequireAuth() {
  const status = useAuthStore((state) => state.status)
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

export function RequireAnonymous() {
  const status = useAuthStore((state) => state.status)
  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}
