import type { FormEvent, ReactNode } from 'react'

export function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
}: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  required?: boolean
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-fg)] outline-none ring-[var(--color-accent)] focus:ring-2"
      />
    </label>
  )
}

export function PrimaryButton({
  children,
  disabled,
}: {
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function AuthForm({
  title,
  subtitle,
  error,
  onSubmit,
  children,
}: {
  title: string
  subtitle?: string
  error?: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>
      <form className="space-y-4" onSubmit={onSubmit}>
        {children}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </form>
    </section>
  )
}
