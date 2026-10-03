import { create } from 'zustand'
import { authClient } from '../services/auth/authClient'
import type { AuthUser } from '../services/auth/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

type AuthState = {
  user: AuthUser | null
  status: AuthStatus
  restoreSession: () => Promise<void>
  register: (input: {
    firstName: string
    lastName: string
    email: string
    password: string
  }) => Promise<void>
  login: (input: { email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
}

let restorePromise: Promise<void> | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',

  restoreSession: () => {
    if (get().status !== 'loading') {
      return Promise.resolve()
    }
    if (!restorePromise) {
      restorePromise = authClient
        .me()
        .then((user) => {
          set({
            user,
            status: user ? 'authenticated' : 'anonymous',
          })
        })
        .catch(() => {
          set({ user: null, status: 'anonymous' })
        })
        .finally(() => {
          restorePromise = null
        })
    }
    return restorePromise
  },

  register: async (input) => {
    const user = await authClient.register(input)
    set({ user, status: 'authenticated' })
  },

  login: async (input) => {
    const user = await authClient.login(input)
    set({ user, status: 'authenticated' })
  },

  logout: async () => {
    await authClient.logout()
    set({ user: null, status: 'anonymous' })
  },
}))
