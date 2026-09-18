import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/auth'
import { AuthForm, Field, PrimaryButton } from '../components/AuthForm'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }
    setPending(true)
    setError(null)
    try {
      await authApi.resetPassword({ token, password, passwordConfirm })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ссылка недействительна')
    } finally {
      setPending(false)
    }
  }

  if (!token) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Нет токена</h1>
        <Link className="text-sm text-[var(--color-accent)]" to="/forgot-password">
          Запросить новую ссылку
        </Link>
      </section>
    )
  }

  if (done) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Пароль обновлён</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Старые сессии сброшены. Войдите с новым паролем.
        </p>
        <button
          type="button"
          className="text-sm text-[var(--color-accent)]"
          onClick={() => navigate('/login')}
        >
          Войти
        </button>
      </section>
    )
  }

  return (
    <AuthForm title="Новый пароль" error={error} onSubmit={onSubmit}>
      <Field
        label="Пароль"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />
      <Field
        label="Подтверждение пароля"
        type="password"
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        autoComplete="new-password"
      />
      <PrimaryButton disabled={pending}>
        {pending ? 'Сохранение…' : 'Сохранить пароль'}
      </PrimaryButton>
    </AuthForm>
  )
}
