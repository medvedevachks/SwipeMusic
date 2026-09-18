import { create } from 'zustand'
import type { SyncStatus } from '../types/sync'

export type SessionUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  emailVerified: boolean
  createdAt: string
  collectionEmpty: boolean
}

type SessionState = {
  user: SessionUser | null
  loading: boolean
  syncStatus: SyncStatus
  syncError: string | null
  importPrompt: boolean
  connectionError: string | null
  setUser: (user: SessionUser | null) => void
  setLoading: (loading: boolean) => void
  setSyncStatus: (status: SyncStatus, error?: string | null) => void
  setImportPrompt: (value: boolean) => void
  setConnectionError: (value: string | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  loading: true,
  syncStatus: 'local',
  syncError: null,
  importPrompt: false,
  connectionError: null,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setSyncStatus: (syncStatus, syncError = null) => set({ syncStatus, syncError }),
  setImportPrompt: (importPrompt) => set({ importPrompt }),
  setConnectionError: (connectionError) => set({ connectionError }),
}))
