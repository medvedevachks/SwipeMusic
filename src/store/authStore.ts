import { create } from 'zustand'
import { authClient } from '../services/auth/authClient.ts'
import { notifyAuthSessionChanged } from '../services/auth/authSessionSync.ts'
import { bindAuthSessionEpoch } from '../services/auth/sessionEpoch.ts'
import type { AuthUser } from '../services/auth/types'
import { getContinuationSession } from '../services/continuation/ContinuationSession.ts'
import { clearContinuousDiscoveryRuntime } from '../services/recommendation/continuousSession.ts'
import { invalidateContinuousBuffer } from '../services/recommendation/continuousBuffer.ts'
import { bindSessionTasteUser } from '../services/taste/loadSessionTasteProfile.ts'
import { tasteProfileCache } from '../services/taste/profileCache.ts'
import { bindSearchHistoryUser } from './searchHistoryBind.ts'

function clearContinuousRuntimeOnAuthChange(): void {
  getContinuationSession().cancel()
  invalidateContinuousBuffer('auth-change')
  clearContinuousDiscoveryRuntime('auth-change')
}

/** Dynamic import: не тянуть AudioPlayer в node:test graph authStore. */
function bindPlaybackSessionsSafe(userId: string | null): void {
  void import('../services/sessionSwitch/featureFlag.ts')
    .then((flag) => flag.refreshSessionSwitchFromServer())
    .catch(() => false)
    .then(() =>
      import('../services/sessionSwitch/integration/playbackSessionBootstrap.ts'),
    )
    .then(async (mod) => {
      if (!userId) {
        await mod.teardownPlaybackSessionsForAuth()
        return
      }
      await mod.bindPlaybackSessionsForAuth(userId)
    })
    .catch(() => {
      // Session bootstrap не должен ломать login / restore
    })
}

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
          bindSessionTasteUser(user?.id ?? null)
          bindSearchHistoryUser(user?.id ?? null)
          bindAuthSessionEpoch(user?.id ?? null)
          clearContinuousRuntimeOnAuthChange()
          bindPlaybackSessionsSafe(user?.id ?? null)
          set({
            user,
            status: user ? 'authenticated' : 'anonymous',
          })
          notifyAuthSessionChanged()
        })
        .catch(() => {
          tasteProfileCache.invalidate()
          bindSessionTasteUser(null)
          bindSearchHistoryUser(null)
          bindAuthSessionEpoch(null)
          clearContinuousRuntimeOnAuthChange()
          bindPlaybackSessionsSafe(null)
          set({ user: null, status: 'anonymous' })
          notifyAuthSessionChanged()
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
    bindSessionTasteUser(user.id)
    bindSearchHistoryUser(user.id)
    bindAuthSessionEpoch(user.id)
    clearContinuousRuntimeOnAuthChange()
    bindPlaybackSessionsSafe(user.id)
    set({ user, status: 'authenticated' })
    notifyAuthSessionChanged()
  },

  login: async (input) => {
    const user = await authClient.login(input)
    tasteProfileCache.invalidate()
    bindSessionTasteUser(user.id)
    bindSearchHistoryUser(user.id)
    bindAuthSessionEpoch(user.id)
    clearContinuousRuntimeOnAuthChange()
    bindPlaybackSessionsSafe(user.id)
    set({ user, status: 'authenticated' })
    notifyAuthSessionChanged()
  },

  logout: async () => {
    await authClient.logout()
    tasteProfileCache.invalidate()
    bindSessionTasteUser(null)
    bindSearchHistoryUser(null)
    bindAuthSessionEpoch(null)
    clearContinuousRuntimeOnAuthChange()
    bindPlaybackSessionsSafe(null)
    set({ user: null, status: 'anonymous' })
    notifyAuthSessionChanged()
  },
}))
