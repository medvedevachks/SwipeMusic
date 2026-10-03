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

export default function Register() {
  const navigate = useNavigate()
  const register = useAuthStore((state) => state.register)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
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
      await register({ firstName, lastName, email, password })
      navigate('/', { replace: true })
    } catch (error) {
      if (error instanceof AuthApiError) {
        if (error.code === 'EMAIL_TAKEN') {
          setFormError('Этот email уже зарегистрирован')
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
      title="Создать аккаунт"
      footer={
        <>
          Уже есть аккаунт? <AuthLink to="/login">Войти</AuthLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <AuthField
          label="Имя"
          name="firstName"
          type="text"
          autoComplete="given-name"
          value={firstName}
          error={fields.firstName}
          onChange={setFirstName}
        />
        <AuthField
          label="Фамилия"
          name="lastName"
          type="text"
          autoComplete="family-name"
          value={lastName}
          error={fields.lastName}
          onChange={setLastName}
        />
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
          autoComplete="new-password"
          value={password}
          error={fields.password}
          onChange={setPassword}
        />
        {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
        <AuthSubmit pending={pending}>Создать аккаунт</AuthSubmit>
      </form>
    </AuthLayout>
  )
}
