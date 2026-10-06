import type { YandexAuthSession } from './types'
import type { YandexConnectionView, YandexPublicProfile } from './sessionClient'

export type YandexLegacyStorage = {
  readLegacy: () => Promise<YandexAuthSession | null>
  removeLegacy: () => Promise<void>
  readOwner: () => Promise<string | null>
  writeOwner: (userId: string) => Promise<void>
  clearLibrary: () => Promise<void>
}

export type YandexReconcileResult = {
  connected: boolean
  unauthenticated: boolean
  migrated: boolean
  legacyRemoved: boolean
  foreignCacheCleared: boolean
  profile: YandexPublicProfile | null
}

export async function reconcileYandexConnection(input: {
  userId: string | null
  readStatus: () => Promise<YandexConnectionView>
  saveLegacy: (session: YandexAuthSession) => Promise<YandexPublicProfile>
  storage: YandexLegacyStorage
}): Promise<YandexReconcileResult> {
  if (!input.userId) {
    return {
      connected: false,
      unauthenticated: true,
      migrated: false,
      legacyRemoved: false,
      foreignCacheCleared: false,
      profile: null,
    }
  }

  const owner = await input.storage.readOwner()
  let foreignCacheCleared = false
  if (owner !== input.userId) {
    await input.storage.clearLibrary()
    await input.storage.writeOwner(input.userId)
    foreignCacheCleared = true
  }

  const status = await input.readStatus()
  if (status.kind === 'unauthenticated') {
    return {
      connected: false,
      unauthenticated: true,
      migrated: false,
      legacyRemoved: false,
      foreignCacheCleared,
      profile: null,
    }
  }

  if (status.connected) {
    const legacy = await input.storage.readLegacy()
    if (legacy?.accessToken) {
      await input.storage.removeLegacy()
      return {
        connected: true,
        unauthenticated: false,
        migrated: false,
        legacyRemoved: true,
        foreignCacheCleared,
        profile: status.profile,
      }
    }
    return {
      connected: true,
      unauthenticated: false,
      migrated: false,
      legacyRemoved: false,
      foreignCacheCleared,
      profile: status.profile,
    }
  }

  const legacy = await input.storage.readLegacy()
  if (!legacy?.accessToken) {
    return {
      connected: false,
      unauthenticated: false,
      migrated: false,
      legacyRemoved: false,
      foreignCacheCleared,
      profile: null,
    }
  }

  try {
    const profile = await input.saveLegacy(legacy)
    await input.storage.removeLegacy()
    return {
      connected: true,
      unauthenticated: false,
      migrated: true,
      legacyRemoved: true,
      foreignCacheCleared,
      profile,
    }
  } catch {
    return {
      connected: false,
      unauthenticated: false,
      migrated: false,
      legacyRemoved: false,
      foreignCacheCleared,
      profile: null,
    }
  }
}

export async function persistNewYandexSession(
  session: YandexAuthSession,
  save: (session: YandexAuthSession) => Promise<YandexPublicProfile>,
): Promise<YandexPublicProfile> {
  return save(session)
}

export async function disconnectYandexAccount(actions: {
  deleteRemote: () => Promise<void>
  removeLegacy: () => Promise<void>
  clearLibrary: () => Promise<void>
}): Promise<void> {
  await actions.deleteRemote()
  await actions.removeLegacy()
  await actions.clearLibrary()
}
