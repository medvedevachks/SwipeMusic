import { create } from 'zustand'

export type LibraryPersistenceStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error'

export const SAVE_FAILED_MESSAGE = 'Не удалось сохранить изменения.'
export const LOAD_FAILED_MESSAGE = 'Не удалось загрузить библиотеку.'

type LibraryPersistenceState = {
  status: LibraryPersistenceStatus
  message: string | null
  armed: boolean
  setStatus: (status: LibraryPersistenceStatus, message?: string | null) => void
  setArmed: (armed: boolean) => void
}

export const useLibraryPersistenceStore = create<LibraryPersistenceState>((set) => ({
  status: 'idle',
  message: null,
  armed: false,
  setStatus: (status, message = null) => set({ status, message }),
  setArmed: (armed) => set({ armed }),
}))

export function isLibraryPersistenceArmed(): boolean {
  return useLibraryPersistenceStore.getState().armed
}
