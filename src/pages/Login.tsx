import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSubmit,
} from '../components/auth/AuthForm'
import { AuthApiError } from '../services/auth/types'
import { authFormError } from '../services/auth/messages'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setFormError(null)
    setFields({})
    try {
      await login({ email, password })
      navigate('/', { replace: true })
    } catch (error) {
      if (error instanceof AuthApiError) {
        if (error.code === 'INVALID_CREDENTIALS') {
          setFormError('Неверный email или пароль')
        } else if (error.code === 'VALIDATION') {
          setFields(error.fields)
        } else {
          setFormError(authFormError(error))
        }
      } else {
        setFormError(authFormError(error))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Войти"
      footer={
        <>
          <AuthLink to="/forgot-password">Забыли пароль?</AuthLink>
          {' · '}
          Нет аккаунта? <AuthLink to="/register">Создать аккаунт</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          error={fields.email}
          onChange={setEmail}
        />
        <AuthField
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={fields.password}
          onChange={setPassword}
        />
        {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
        <AuthSubmit pending={pending}>Войти</AuthSubmit>
      </form>
    </AuthLayout>
  )
}
