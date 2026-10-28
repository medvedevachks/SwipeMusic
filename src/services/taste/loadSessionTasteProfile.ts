import { isSearchSeedPlaybackEnabled } from '../continuation/searchSeedPlayback.ts'
import type { UserTasteProfile } from './types.ts'

const PROFILE_TIMEOUT_MS = 8_000

type CachedProfile = {
  userId: string
  profile: UserTasteProfile
}

let generation = 0
let sessionUserId: string | null = null
let cached: CachedProfile | null = null

/**
 * Текущий пользователь известен только после ответа сервера на вход или /me.
 * Смена владельца увеличивает поколение и стирает кэш.
 */
export function bindSessionTasteUser(userId: string | null): void {
  generation += 1
  sessionUserId = userId
  cached = null
}

/** Сброс при смене сессии. Профиль A нельзя отдать пользователю B. */
export function invalidateSessionTasteProfile(): void {
  generation += 1
  cached = null
}

function acceptProfile(value: unknown): UserTasteProfile | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const profile = value as UserTasteProfile
  if (profile.schemaVersion !== 1 || !Array.isArray(profile.tracks)) {
    return null
  }
  if (typeof profile.userId !== 'string' || profile.userId.length === 0) {
    return null
  }
  return profile
}

function stillCurrent(ticket: number, ownerAtStart: string | null): boolean {
  return ticket === generation && ownerAtStart === sessionUserId
}

/**
 * Профиль текущей серверной сессии.
 * Вне включённого автопродолжения запрос не уходит.
 * Идентификатор пользователя из клиента не передаётся.
 * Опоздавший ответ другого поколения или другого владельца отбрасывается.
 */
export async function loadSessionTasteProfile(): Promise<UserTasteProfile | null> {
  if (!isSearchSeedPlaybackEnabled()) {
    return null
  }
  if (cached && (sessionUserId === null || cached.userId === sessionUserId)) {
    return cached.profile
  }
  if (cached) {
    cached = null
  }
  const ticket = generation
  const ownerAtStart = sessionUserId
  try {
    const response = await fetch('/api/me/taste-profile', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    })
    if (!stillCurrent(ticket, ownerAtStart)) {
      return null
    }
    if (response.status === 401) {
      cached = null
      return null
    }
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as { profile?: unknown }
    const profile = acceptProfile(body.profile)
    if (!profile || !stillCurrent(ticket, ownerAtStart)) {
      return null
    }
    if (sessionUserId !== null && profile.userId !== sessionUserId) {
      return null
    }
    cached = { userId: profile.userId, profile }
    return profile
  } catch {
    return null
  }
}
