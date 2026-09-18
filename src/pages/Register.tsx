import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { AuthForm, Field, PrimaryButton } from '../components/AuthForm'
import { restoreSession } from '../services/sync/collectionSync'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 8) {
      setError('Пароль не короче 8 символов')
      return
    }
    setPending(true)
    setError(null)
    try {
      await authApi.register({
        firstName,
        lastName,
        email,
        password,
        passwordConfirm,
      })
      await restoreSession()
      navigate('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthForm
      title="Регистрация"
      subtitle="Коллекция сохранится в облаке после подтверждения почты."
      error={error}
      onSubmit={onSubmit}
    >
      <Field label="Имя" value={firstName} onChange={setFirstName} autoComplete="given-name" />
      <Field label="Фамилия" value={lastName} onChange={setLastName} autoComplete="family-name" />
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
        {pending ? 'Создание…' : 'Создать аккаунт'}
      </PrimaryButton>
      <p className="text-sm text-[var(--color-muted)]">
        Уже есть аккаунт?{' '}
        <Link className="text-[var(--color-accent)]" to="/login">
          Войти
        </Link>
      </p>
    </AuthForm>
  )
}
