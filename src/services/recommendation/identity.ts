import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { Track } from '../../types/track.ts'
import type { RecommendationExcludedTrack } from './types.ts'

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function titleIdentity(artist: string, title: string): string {
  return `${normalizeText(artist)}|${normalizeText(title)}`
}

export function copyIdentity(track: { sourceId: string; externalId: string }): string {
  return `${track.sourceId}:${track.externalId}`
}

export function buildExclusionSets(excluded: readonly RecommendationExcludedTrack[]): {
  ids: Set<string>
  copies: Set<string>
  titles: Set<string>
} {
  const ids = new Set<string>()
  const copies = new Set<string>()
  const titles = new Set<string>()
  for (const item of excluded) {
    if (item.id) {
      ids.add(item.id)
    }
    if (item.sourceId && item.externalId) {
      copies.add(copyIdentity({ sourceId: item.sourceId, externalId: item.externalId }))
    }
    titles.add(titleIdentity(item.artist, item.title))
  }
  return { ids, copies, titles }
}

export function isExcludedTrack(
  track: Track,
  sets: ReturnType<typeof buildExclusionSets>,
): boolean {
  if (!track.externalId || isDemoSourceId(track.sourceId)) {
    return true
  }
  if (sets.ids.has(track.id)) {
    return true
  }
  if (sets.copies.has(copyIdentity(track))) {
    return true
  }
  return sets.titles.has(titleIdentity(track.artist, track.title))
}
