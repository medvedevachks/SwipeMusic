import type { UserTasteProfile } from './types.ts'

/**
 * Профиль текущей сессии. Вызывается только когда DEV-режим радио уже taste.
 * Идентификатор пользователя из клиента не передаётся.
 */
export async function loadSessionTasteProfile(): Promise<UserTasteProfile | null> {
  if (import.meta.env.DEV !== true) {
    return null
  }
  try {
    const response = await fetch('/api/me/taste-profile', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as { profile?: UserTasteProfile }
    if (body.profile?.schemaVersion !== 1 || !Array.isArray(body.profile.tracks)) {
      return null
    }
    return body.profile
  } catch {
    return null
  }
}
