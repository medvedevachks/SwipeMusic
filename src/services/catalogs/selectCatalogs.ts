import type { Catalog, TrackAssignment } from '../../types/category.ts'
import type { CollectionTrackData } from '../../types/collectionUser.ts'
import type { Track } from '../../types/track.ts'

export type CatalogTrackItem = {
  trackId: string
  track: Track | null
  sourceId: string
  liked: boolean
}

export function listCatalogs(catalogs: readonly Catalog[]): Catalog[] {
  return [...catalogs].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }
    return left.name.localeCompare(right.name, 'ru')
  })
}

export function getCatalogById(
  catalogs: readonly Catalog[],
  catalogId: string,
): Catalog | null {
  return catalogs.find((catalog) => catalog.id === catalogId) ?? null
}

export function getCatalogTrackCount(
  assignments: readonly TrackAssignment[],
  catalogId: string,
): number {
  return assignments.filter((assignment) => assignment.categoryId === catalogId)
    .length
}

export function getTracksForCatalog(
  catalogId: string,
  assignments: readonly TrackAssignment[],
  records: readonly CollectionTrackData[],
): CatalogTrackItem[] {
  const byId = new Map(records.map((record) => [record.trackId, record]))
  return assignments
    .filter((assignment) => assignment.categoryId === catalogId)
    .map((assignment) => {
      const record = byId.get(assignment.trackId)
      return {
        trackId: assignment.trackId,
        track: record?.track ?? null,
        sourceId: record?.sourceId ?? sourceIdFromTrackId(assignment.trackId),
        liked: record?.liked ?? false,
      }
    })
}

export function canDeleteCatalog(catalog: Catalog): boolean {
  return catalog.system !== true
}

export function formatCatalogTrackCount(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} трек`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} трека`
  }
  return `${count} треков`
}

function sourceIdFromTrackId(trackId: string): string {
  const index = trackId.indexOf(':')
  return index === -1 ? trackId : trackId.slice(0, index)
}
