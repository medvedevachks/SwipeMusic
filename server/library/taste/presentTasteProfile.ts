import type { TasteTrackKey, UserTasteProfile } from '../../../src/services/taste/types.ts'

const MAX_RESPONSE_TRACKS = 500

function keyText(key: TasteTrackKey): string {
  if (key.kind === 'canonical') {
    return `canonical:${key.canonicalTrackId}`
  }
  return `source:${key.sourceId}:${key.externalId}`
}

/**
 * Ответ профиля ограничен по размеру и содержит только поля вкуса.
 * Токены источников и адреса потоков сюда не входят.
 */
export function boundTasteProfileResponse(profile: UserTasteProfile): UserTasteProfile {
  if (profile.tracks.length <= MAX_RESPONSE_TRACKS) {
    return profile
  }
  const tracks = [...profile.tracks]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return keyText(left.key).localeCompare(keyText(right.key))
    })
    .slice(0, MAX_RESPONSE_TRACKS)
  return {
    schemaVersion: 1,
    userId: profile.userId,
    builtAt: profile.builtAt,
    empty: tracks.length === 0 && profile.catalogs.length === 0 && profile.recentActivity.length === 0,
    tracks,
    catalogs: profile.catalogs,
    recentActivity: profile.recentActivity,
  }
}
