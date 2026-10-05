import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { TrackMeta } from '../../types/trackMeta.ts'
import type { Track } from '../../types/track.ts'
import { sourceTrackKeyOf } from './mapCanonical.ts'

export type CanonicalLookup = {
  itemsById: Record<string, CanonicalLibraryItem>
  sourceKeyToCanonicalId: Record<string, string>
}

export function listCanonicalItems(
  items: readonly CanonicalLibraryItem[],
): CanonicalLibraryItem[] {
  return [...items].sort(byTitle)
}

export function canonicalTracksInCatalog(
  items: readonly CanonicalLibraryItem[],
  catalogId: string,
): CanonicalLibraryItem[] {
  return items.filter((item) => item.catalogIds.includes(catalogId)).sort(byTitle)
}

export function canonicalCatalogCount(
  items: readonly CanonicalLibraryItem[],
  catalogId: string,
): number {
  return items.filter((item) => item.catalogIds.includes(catalogId)).length
}

export function canonicalItemForTrack(
  lookup: CanonicalLookup,
  track: Pick<Track, 'id' | 'sourceId' | 'externalId'>,
): CanonicalLibraryItem | null {
  const key = sourceTrackKeyOf(track)
  const canonicalId = lookup.sourceKeyToCanonicalId[key] ?? lookup.sourceKeyToCanonicalId[track.id]
  if (!canonicalId) {
    return null
  }
  return lookup.itemsById[canonicalId] ?? null
}

export function isSourceCopyLiked(lookup: CanonicalLookup, sourceTrackKey: string): boolean {
  const canonicalId = lookup.sourceKeyToCanonicalId[sourceTrackKey]
  if (!canonicalId) {
    return false
  }
  return lookup.itemsById[canonicalId]?.state.liked ?? false
}

/** Лайк композиции показывается на каждой её SourceCopy, но состояние одно. */
export function likedSourceKeys(item: CanonicalLibraryItem): string[] {
  if (!item.state.liked) {
    return []
  }
  return item.copies.map((copy) => copy.sourceTrackKey)
}

export function projectCanonicalMeta(
  meta: TrackMeta,
  item: CanonicalLibraryItem | null,
): TrackMeta {
  if (!item) {
    return meta
  }
  return {
    ...meta,
    liked: item.state.liked,
    categoryIds: [...item.catalogIds],
  }
}

export function formatSourceCopyCount(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} источник`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} источника`
  }
  return `${count} источников`
}

function byTitle(left: CanonicalLibraryItem, right: CanonicalLibraryItem): number {
  const byName = left.canonicalTrack.title.localeCompare(right.canonicalTrack.title, 'ru')
  if (byName !== 0) {
    return byName
  }
  return left.canonicalTrack.id.localeCompare(right.canonicalTrack.id)
}
