import { AuthApiError, type AuthFieldErrors, type AuthUser } from './types'

const AUTH_ROOT = '/api/auth'

type AuthResponse = {
  user?: AuthUser
  error?: string
  fields?: AuthFieldErrors
}

async function request(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<AuthResponse & { status: number }> {
  const response = await fetch(`${AUTH_ROOT}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  let payload: AuthResponse = {}
  try {
    payload = (await response.json()) as AuthResponse
  } catch {
    payload = {}
  }

  return { ...payload, status: response.status }
}

function fail(result: AuthResponse & { status: number }): never {
  throw new AuthApiError(
    result.status,
    result.error ?? 'REQUEST_FAILED',
    result.fields ?? {},
  )
}

export const authClient = {
  async register(input: {
    firstName: string
    lastName: string
    email: string
    password: string
  }): Promise<AuthUser> {
    const result = await request('/register', { method: 'POST', body: input })
    if (result.status !== 201 || !result.user) {
      fail(result)
    }
    return result.user
  },

  async login(input: { email: string; password: string }): Promise<AuthUser> {
    const result = await request('/login', { method: 'POST', body: input })
    if (result.status !== 200 || !result.user) {
      fail(result)
    }
    return result.user
  },

  async logout(): Promise<void> {
    const result = await request('/logout', { method: 'POST' })
    if (result.status !== 200) {
      fail(result)
    }
  },

  async me(): Promise<AuthUser | null> {
    const result = await request('/me')
    if (result.status === 401) {
      return null
    }
    if (result.status !== 200 || !result.user) {
      fail(result)
    }
    return result.user
  },

  async forgotPassword(email: string): Promise<void> {
    const result = await request('/forgot-password', {
      method: 'POST',
      body: { email },
    })
    if (result.status !== 200) {
      fail(result)
    }
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const result = await request('/reset-password', {
      method: 'POST',
      body: { token, password },
    })
    if (result.status !== 200) {
      fail(result)
    }
  },
}
