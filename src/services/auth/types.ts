export type AuthUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

export type AuthFieldErrors = Record<string, string>

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: AuthFieldErrors

  constructor(status: number, code: string, fields: AuthFieldErrors = {}) {
    super(code)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}
