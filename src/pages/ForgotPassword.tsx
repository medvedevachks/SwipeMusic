import { useState, type FormEvent } from 'react'
import {
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSubmit,
} from '../components/auth/AuthForm'
import { authClient } from '../services/auth/authClient'
import { authFormError } from '../services/auth/messages'
import { AuthApiError } from '../services/auth/types'

const SENT_MESSAGE =
  'Если аккаунт с такой почтой существует, мы отправили инструкцию по восстановлению.'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setFormError(null)
    setFields({})
    try {
      await authClient.forgotPassword(email)
      setSent(true)
    } catch (error) {
      if (error instanceof AuthApiError && error.code === 'VALIDATION') {
        setFields(error.fields)
      } else if (error instanceof AuthApiError && error.code === 'RATE_LIMITED') {
        setFormError('Слишком много запросов. Попробуйте позже.')
      } else {
        setFormError(authFormError(error))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Восстановить пароль"
      footer={
        <>
          <AuthLink to="/login">Войти</AuthLink>
        </>
      }
    >
      {sent ? (
        <p className="text-sm text-[var(--color-fg)]">{SENT_MESSAGE}</p>
      ) : (
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
          {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
          <AuthSubmit pending={pending}>Восстановить пароль</AuthSubmit>
        </form>
      )}
    </AuthLayout>
  )
}
