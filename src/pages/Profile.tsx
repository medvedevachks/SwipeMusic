import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function Profile() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  const onLogout = () => {
    void logout().then(() => {
      navigate('/login', { replace: true })
    })
  }

  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
        Профиль
      </h1>
      {user ? (
        <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div>
            <p className="text-base font-medium text-[var(--color-fg)]">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-sm text-[var(--color-muted)]">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-fg)]"
          >
            Выйти
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Link
          to="/queue"
          className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Очередь воспроизведения
        </Link>
        <Link
          to="/sources"
          className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-fg)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Источники музыки
        </Link>
      </div>
    </section>
  )
}
