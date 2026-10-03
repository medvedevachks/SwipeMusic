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

  if (password.length < PASSWORD_MIN) {
    fields.password = `Пароль не короче ${PASSWORD_MIN} символов`
  } else if (password.length > PASSWORD_MAX) {
    fields.password = `Пароль не длиннее ${PASSWORD_MAX} символов`
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
