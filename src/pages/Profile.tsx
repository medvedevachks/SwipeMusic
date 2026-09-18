import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { Field, PrimaryButton } from '../components/AuthForm'
import { useSessionStore } from '../store/sessionStore'

const statusLabel = {
  local: 'Сохранено локально',
  syncing: 'Синхронизация',
  cloud: 'Сохранено в облаке',
  error: 'Ошибка синхронизации',
}

export default function Profile() {
  const navigate = useNavigate()
  const user = useSessionStore((state) => state.user)
  const syncStatus = useSessionStore((state) => state.syncStatus)
  const connectionError = useSessionStore((state) => state.connectionError)
  const setUser = useSessionStore((state) => state.setUser)

  const [firstName, setFirstName] = useState(user?.firstName ?? '')
  const [lastName, setLastName] = useState(user?.lastName ?? '')
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!user) {
    return (
      <section className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Профиль</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Войдите, чтобы синхронизировать коллекцию между устройствами.
        </p>
        {connectionError ? (
          <p className="text-sm text-rose-600">{connectionError}</p>
        ) : null}
        <div className="flex gap-3">
          <Link
            to="/login"
            className="inline-flex h-11 items-center rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-white"
          >
            Войти
          </Link>
          <Link
            to="/register"
            className="inline-flex h-11 items-center rounded-xl border border-[var(--color-border)] px-4 text-sm"
          >
            Регистрация
          </Link>
        </div>
      </section>
    )
  }

  async function wrap(action: () => Promise<unknown>, success: string) {
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(success)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Личный кабинет</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {user.emailVerified ? 'Почта подтверждена' : 'Почта не подтверждена'} ·{' '}
          {statusLabel[syncStatus]}
        </p>
      </div>

      {connectionError ? <p className="text-sm text-rose-600">{connectionError}</p> : null}
      {message ? <p className="text-sm text-[var(--color-accent)]">{message}</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
        <p>
          {user.firstName} {user.lastName}
        </p>
        <p className="text-[var(--color-muted)]">{user.email}</p>
        <p className="text-[var(--color-muted)]">
          Регистрация: {new Date(user.createdAt).toLocaleDateString('ru-RU')}
        </p>
      </div>

      {!user.emailVerified ? (
        <button
          type="button"
          className="text-sm text-[var(--color-accent)]"
          onClick={() =>
            wrap(() => authApi.resendVerification(), 'Письмо отправлено')
          }
        >
          Отправить письмо подтверждения ещё раз
        </button>
      ) : null}

      <form
        className="space-y-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void wrap(
            async () => {
              await authApi.updateProfile({ firstName, lastName })
              const { user: next } = await authApi.me()
              setUser(next)
            },
            'Имя обновлено',
          )
        }}
      >
        <h2 className="text-base font-semibold">Имя и фамилия</h2>
        <Field label="Имя" value={firstName} onChange={setFirstName} />
        <Field label="Фамилия" value={lastName} onChange={setLastName} />
        <PrimaryButton>Сохранить</PrimaryButton>
      </form>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void wrap(
            () => authApi.changeEmail(newEmail),
            'Подтвердите новый email письмом',
          )
        }}
      >
        <h2 className="text-base font-semibold">Смена email</h2>
        <Field
          label="Новый email"
          type="email"
          value={newEmail}
          onChange={setNewEmail}
          autoComplete="email"
        />
        <PrimaryButton>Отправить подтверждение</PrimaryButton>
      </form>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void wrap(
            () =>
              authApi.changePassword({
                currentPassword,
                password,
                passwordConfirm,
              }),
            'Пароль изменён, другие сессии закрыты',
          )
        }}
      >
        <h2 className="text-base font-semibold">Смена пароля</h2>
        <Field
          label="Текущий пароль"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <Field
          label="Новый пароль"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <Field
          label="Подтверждение"
          type="password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
          autoComplete="new-password"
        />
        <PrimaryButton>Сменить пароль</PrimaryButton>
      </form>

      <button
        type="button"
        className="h-11 w-full rounded-xl border border-[var(--color-border)] text-sm"
        onClick={() => {
          void authApi.logout().finally(() => {
            setUser(null)
            navigate('/login')
          })
        }}
      >
        Выйти
      </button>

      <form
        className="space-y-3 rounded-2xl border border-rose-300/60 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void wrap(async () => {
            await authApi.deleteAccount(deletePassword)
            setUser(null)
            navigate('/register')
          }, 'Аккаунт удалён')
        }}
      >
        <h2 className="text-base font-semibold">Удаление аккаунта</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Удалит профиль и коллекцию в облаке. Локальная резервная копия на этом
          устройстве может остаться в IndexedDB до очистки сайта.
        </p>
        <Field
          label="Пароль для подтверждения"
          type="password"
          value={deletePassword}
          onChange={setDeletePassword}
        />
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-rose-600 text-sm font-medium text-white"
        >
          Удалить аккаунт
        </button>
      </form>
    </section>
  )
}
