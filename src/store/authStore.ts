import { create } from 'zustand'
import { authClient } from '../services/auth/authClient.ts'
import type { AuthUser } from '../services/auth/types'
import { tasteProfileCache } from '../services/taste/profileCache.ts'

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
          tasteProfileCache.invalidate()
          set({
            user,
            status: user ? 'authenticated' : 'anonymous',
          })
        })
        .catch(() => {
          tasteProfileCache.invalidate()
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
    tasteProfileCache.invalidate()
    set({ user, status: 'authenticated' })
  },

  login: async (input) => {
    const user = await authClient.login(input)
    tasteProfileCache.invalidate()
    set({ user, status: 'authenticated' })
  },

  logout: async () => {
    await authClient.logout()
    tasteProfileCache.invalidate()
    set({ user: null, status: 'anonymous' })
  },
}))
