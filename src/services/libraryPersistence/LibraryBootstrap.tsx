import { useEffect } from 'react'
import { useAuthStore } from '../../store/authStore'
import { installAuthSessionSync } from '../auth/authSessionSync.ts'
import { bootstrapLibrary, resetLibrarySession } from './session.ts'

/** Один bootstrap на user.id. Повторный mount той же сессии не шлёт второй запрос. */
export default function LibraryBootstrap() {
  const userId = useAuthStore((state) => state.user?.id ?? null)

  useEffect(() => {
    if (!userId) {
      resetLibrarySession()
      return
    }
    void bootstrapLibrary(userId)
  }, [userId])

  useEffect(() => installAuthSessionSync(), [])

  return null
}
