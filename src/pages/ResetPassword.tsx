import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSubmit,
} from '../components/auth/AuthForm'
import { authClient } from '../services/auth/authClient'
import { authFormError } from '../services/auth/messages'
import { AuthApiError } from '../services/auth/types'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setFields({})
    if (password !== confirmPassword) {
      setFields({ confirmPassword: 'Пароли не совпадают' })
      return
    }
    setPending(true)
    try {
      await authClient.resetPassword(token, password)
      setDone(true)
    } catch (error) {
      if (error instanceof AuthApiError && error.code === 'VALIDATION') {
        setFields(error.fields)
      } else if (error instanceof AuthApiError && error.code === 'INVALID_RESET_TOKEN') {
        setFormError('Ссылка недействительна или устарела')
      } else {
        setFormError(authFormError(error))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Новый пароль"
      footer={
        <>
          <AuthLink to="/login">Войти</AuthLink>
        </>
      }
    >
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-fg)]">Пароль изменён</p>
          <AuthLink to="/login">Войти</AuthLink>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit}>
          {!token ? (
            <p className="text-sm text-rose-600">Ссылка восстановления неполная</p>
          ) : null}
          <AuthField
            label="Новый пароль"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            error={fields.password}
            onChange={setPassword}
          />
          <AuthField
            label="Повторите пароль"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            error={fields.confirmPassword}
            onChange={setConfirmPassword}
          />
          {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
          <AuthSubmit pending={pending}>Сохранить новый пароль</AuthSubmit>
        </form>
      )}
    </AuthLayout>
  )
}
