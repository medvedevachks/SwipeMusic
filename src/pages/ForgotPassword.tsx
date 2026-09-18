import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../api/auth'
import { AuthForm, Field, PrimaryButton } from '../components/AuthForm'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">Проверьте почту</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Если аккаунт существует, мы отправили ссылку для сброса пароля.
        </p>
        <Link className="text-sm text-[var(--color-accent)]" to="/login">
          К входу
        </Link>
      </section>
    )
  }

  return (
    <AuthForm
      title="Восстановление доступа"
      subtitle="Укажите email — отправим одноразовую ссылку."
      onSubmit={onSubmit}
    >
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <PrimaryButton disabled={pending}>
        {pending ? 'Отправка…' : 'Отправить ссылку'}
      </PrimaryButton>
    </AuthForm>
  )
}
