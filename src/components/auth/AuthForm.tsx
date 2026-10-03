import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthLayoutProps = {
  title: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-10">
      <section className="w-full max-w-md space-y-6 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-sm text-[var(--color-muted)]">Swipe Music</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
            {title}
          </h1>
        </div>
        {children}
        <p className="text-sm text-[var(--color-muted)]">{footer}</p>
      </section>
    </div>
  )
}

export function AuthField({
  label,
  name,
  type,
  autoComplete,
  value,
  error,
  onChange,
}: {
  label: string
  name: string
  type: 'text' | 'email' | 'password'
  autoComplete: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-[var(--color-fg)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-base text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
      />
      {error ? <span className="block text-rose-600">{error}</span> : null}
    </label>
  )
}

export function AuthSubmit({
  children,
  pending,
}: {
  children: string
  pending: boolean
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? 'Подождите…' : children}
    </button>
  )
}

export function AuthLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="font-medium text-[var(--color-accent)]">
      {children}
    </Link>
  )
}
