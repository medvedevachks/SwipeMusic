import { readUserTasteProfile } from './buildTasteProfile.ts'
import type { TasteInput, UserTasteProfile } from './types.ts'

type CacheEntry = {
  userId: string
  fingerprint: string
  profile: UserTasteProfile
}

/**
 * Кэш привязан к пользователю сессии.
 * Профиль пользователя A нельзя отдать пользователю B.
 */
export function createTasteProfileCache() {
  let entry: CacheEntry | null = null

  return {
    read(userId: string, input: TasteInput, builtAt: string): UserTasteProfile {
      const fingerprint = fingerprintOf(input)
      if (entry && entry.userId === userId && entry.fingerprint === fingerprint) {
        return entry.profile
      }
      const profile = readUserTasteProfile(userId, input, builtAt)
      entry = { userId, fingerprint, profile }
      return profile
    },

    invalidate(userId?: string): void {
      if (!entry) {
        return
      }
      if (userId === undefined || entry.userId === userId) {
        entry = null
      }
    },
  }
}

function fingerprintOf(input: TasteInput): string {
  return JSON.stringify(input)
}

export const tasteProfileCache = createTasteProfileCache()
