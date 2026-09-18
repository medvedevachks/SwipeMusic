import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { AuthForm, Field, PrimaryButton } from '../components/AuthForm'
import { restoreSession } from '../services/sync/collectionSync'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await authApi.login({ email, password })
      await restoreSession()
      navigate('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный email или пароль')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthForm
      title="Вход"
      subtitle="Сессия сохранится на этом устройстве."
      error={error}
      onSubmit={onSubmit}
    >
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <Field
        label="Пароль"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <PrimaryButton disabled={pending}>{pending ? 'Вход…' : 'Войти'}</PrimaryButton>
      <div className="space-y-2 text-sm text-[var(--color-muted)]">
        <p>
          Нет аккаунта?{' '}
          <Link className="text-[var(--color-accent)]" to="/register">
            Регистрация
          </Link>
        </p>
        <p>
          <Link className="text-[var(--color-accent)]" to="/forgot-password">
            Восстановить пароль
          </Link>
        </p>
      </div>
    </AuthForm>
  )
}
