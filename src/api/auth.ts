import { apiRequest } from './http'
import type { SessionUser } from '../store/sessionStore'
import type { CollectionSnapshot, SyncOperation } from '../types/sync'

export const authApi = {
  register(input: {
    firstName: string
    lastName: string
    email: string
    password: string
    passwordConfirm: string
  }) {
    return apiRequest<{ ok?: boolean }>('/api/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  login(input: { email: string; password: string }) {
    return apiRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  logout() {
    return apiRequest('/api/logout', { method: 'POST' })
  },

  me() {
    return apiRequest<{ user: SessionUser | null }>('/api/me')
  },

  updateProfile(input: { firstName: string; lastName: string }) {
    return apiRequest('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },

  changeEmail(newEmail: string) {
    return apiRequest('/api/me/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail }),
    })
  },

  changePassword(input: {
    currentPassword: string
    password: string
    passwordConfirm: string
  }) {
    return apiRequest('/api/me/password', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  deleteAccount(password: string) {
    return apiRequest('/api/me/delete', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  },

  forgotPassword(email: string) {
    return apiRequest('/api/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  resetPassword(input: { token: string; password: string; passwordConfirm: string }) {
    return apiRequest('/api/reset-password', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  resendVerification() {
    return apiRequest('/api/resend-verification', { method: 'POST' })
  },

  snapshot() {
    return apiRequest<CollectionSnapshot>('/api/me/sync/snapshot')
  },

  pushOperations(operations: SyncOperation[]) {
    return apiRequest<{ accepted: string[]; duplicates: string[] }>(
      '/api/me/sync/operations',
      {
        method: 'POST',
        body: JSON.stringify({ operations }),
      },
    )
  },
}
