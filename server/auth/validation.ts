const NAME_MAX = 80
const EMAIL_MAX = 254
const PASSWORD_MIN = 10
const PASSWORD_MAX = 128

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type RegisterInput = {
  firstName: string
  lastName: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export type FieldErrors = Record<string, string>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function passwordFieldError(password: string): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Пароль не короче ${PASSWORD_MIN} символов`
  }
  if (password.length > PASSWORD_MAX) {
    return `Пароль не длиннее ${PASSWORD_MAX} символов`
  }
  return null
}

function emailFieldError(email: string): string | null {
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return 'Укажите корректный email'
  }
  return null
}

export function validateRegister(body: unknown):
  | { ok: true; value: RegisterInput }
  | { ok: false; fields: FieldErrors } {
  const record = asRecord(body)
  const fields: FieldErrors = {}
  if (!record) {
    return {
      ok: false,
      fields: { body: 'Ожидается JSON-объект' },
    }
  }

  const firstName = readString(record, 'firstName')
  const lastName = readString(record, 'lastName')
  const email = readString(record, 'email').toLowerCase()
  const password = typeof record.password === 'string' ? record.password : ''

  if (!firstName) {
    fields.firstName = 'Укажите имя'
  } else if (firstName.length > NAME_MAX) {
    fields.firstName = `Имя не длиннее ${NAME_MAX} символов`
  }

  if (!lastName) {
    fields.lastName = 'Укажите фамилию'
  } else if (lastName.length > NAME_MAX) {
    fields.lastName = `Фамилия не длиннее ${NAME_MAX} символов`
  }

  if (!email) {
    fields.email = 'Укажите email'
  } else if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    fields.email = 'Укажите корректный email'
  }

  const passwordError = passwordFieldError(password)
  if (passwordError) {
    fields.password = passwordError
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }

  return {
    ok: true,
    value: { firstName, lastName, email, password },
  }
}

export function validateLogin(body: unknown):
  | { ok: true; value: LoginInput }
  | { ok: false; fields: FieldErrors } {
  const record = asRecord(body)
  const fields: FieldErrors = {}
  if (!record) {
    return {
      ok: false,
      fields: { body: 'Ожидается JSON-объект' },
    }
  }

  const email = readString(record, 'email').toLowerCase()
  const password = typeof record.password === 'string' ? record.password : ''

  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    fields.email = 'Укажите корректный email'
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    fields.password = `Пароль от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }

  return { ok: true, value: { email, password } }
}

export type ForgotPasswordInput = {
  email: string
}

export type ResetPasswordInput = {
  token: string
  password: string
}

export function validateForgotPassword(body: unknown):
  | { ok: true; value: ForgotPasswordInput }
  | { ok: false; fields: FieldErrors } {
  const record = asRecord(body)
  if (!record) {
    return { ok: false, fields: { body: 'Ожидается JSON-объект' } }
  }

  const email = readString(record, 'email').toLowerCase()
  const emailError = emailFieldError(email)
  if (emailError) {
    return { ok: false, fields: { email: emailError } }
  }

  return { ok: true, value: { email } }
}

export function validateResetPassword(body: unknown):
  | { ok: true; value: ResetPasswordInput }
  | { ok: false; fields: FieldErrors } {
  const record = asRecord(body)
  const fields: FieldErrors = {}
  if (!record) {
    return { ok: false, fields: { body: 'Ожидается JSON-объект' } }
  }

  const token = typeof record.token === 'string' ? record.token.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''

  if (!token || token.length > 200) {
    fields.token = 'Ссылка восстановления недействительна'
  }

  const passwordError = passwordFieldError(password)
  if (passwordError) {
    fields.password = passwordError
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }

  return { ok: true, value: { token, password } }
}
