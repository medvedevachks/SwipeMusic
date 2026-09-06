import type {
  LibraryFilters,
  LibraryGroup,
  LibraryQueryState,
  LibrarySectionId,
  LibrarySortDirection,
  LibrarySortField,
} from '../../types/library'
import type { LibraryEntry } from '../../types/trackMeta'
import type { Category } from '../../types/category'
import { getSourceDisplayName } from '../../utils/sourceDisplay'

const UNKNOWN_ALBUM = 'Unknown Album'
const UNKNOWN_ARTIST = 'Unknown Artist'

function matchesQuery(entry: LibraryEntry, query: string, categoryNames: Map<string, string>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) {
    return true
  }

  const { track, meta } = entry
  const haystack = [
    track.title,
    track.artist,
    track.album ?? '',
    track.genre ?? '',
    track.sourceId,
    getSourceDisplayName(track.sourceId),
    meta.folderPath ?? '',
    ...meta.categoryIds.map((id) => categoryNames.get(id) ?? id),
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(q)
}

function applyFilters(
  entries: LibraryEntry[],
  filters: LibraryFilters,
  categoryNames: Map<string, string>,
): LibraryEntry[] {
  return entries.filter((entry) => {
    const { track, meta } = entry

    if (!matchesQuery(entry, filters.query, categoryNames)) {
      return false
    }
    if (filters.sourceIds.length > 0 && !filters.sourceIds.includes(track.sourceId)) {
      return false
    }
    if (
      filters.categoryIds.length > 0 &&
      !filters.categoryIds.some((id) => meta.categoryIds.includes(id))
    ) {
      return false
    }
    if (filters.artists.length > 0 && !filters.artists.includes(track.artist)) {
      return false
    }
    if (
      filters.albums.length > 0 &&
      !filters.albums.includes(track.album ?? UNKNOWN_ALBUM)
    ) {
      return false
    }
    if (filters.likedOnly && !meta.liked && !meta.favorite) {
      return false
    }
    if (filters.hasCategories === true && meta.categoryIds.length === 0) {
      return false
    }
    if (filters.hasCategories === false && meta.categoryIds.length > 0) {
      return false
    }
    if (filters.hasCover === true && !track.coverUrl) {
      return false
    }
    if (filters.hasCover === false && track.coverUrl) {
      return false
    }
    const duration = track.durationMs ?? 0
    if (filters.durationMinMs != null && duration < filters.durationMinMs) {
      return false
    }
    if (filters.durationMaxMs != null && duration > filters.durationMaxMs) {
      return false
    }
    if (filters.playCountMin != null && meta.playCount < filters.playCountMin) {
      return false
    }
    if (filters.playCountMax != null && meta.playCount > filters.playCountMax) {
      return false
    }
    if (filters.skipCountMin != null && meta.skipCount < filters.skipCountMin) {
      return false
    }
    if (filters.skipCountMax != null && meta.skipCount > filters.skipCountMax) {
      return false
    }
    return true
  })
}

function compareEntries(
  a: LibraryEntry,
  b: LibraryEntry,
  field: LibrarySortField,
  direction: LibrarySortDirection,
): number {
  const sign = direction === 'asc' ? 1 : -1
  const av = sortValue(a, field)
  const bv = sortValue(b, field)

  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * sign
  }

  return String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' }) * sign
}

function sortValue(
  entry: LibraryEntry,
  field: LibrarySortField,
): string | number {
  switch (field) {
    case 'title':
      return entry.track.title
    case 'artist':
      return entry.track.artist
    case 'album':
      return entry.track.album ?? UNKNOWN_ALBUM
    case 'addedAt':
      return entry.meta.addedAt
    case 'lastPlayedAt':
      return entry.meta.lastPlayedAt ?? ''
    case 'playCount':
      return entry.meta.playCount
    case 'skipCount':
      return entry.meta.skipCount
    case 'duration':
      return entry.track.durationMs ?? 0
    case 'source':
      return entry.track.sourceId
  }
}

function applySectionPreset(
  entries: LibraryEntry[],
  section: LibrarySectionId,
): LibraryEntry[] {
  switch (section) {
    case 'favorites':
      return entries.filter((entry) => entry.meta.favorite || entry.meta.liked)
    case 'never-played':
      return entries.filter((entry) => entry.meta.playCount === 0)
    case 'recently-added':
      return [...entries].sort((a, b) => b.meta.addedAt.localeCompare(a.meta.addedAt))
    case 'recently-played':
      return entries
        .filter((entry) => entry.meta.lastPlayedAt)
        .sort((a, b) =>
          (b.meta.lastPlayedAt ?? '').localeCompare(a.meta.lastPlayedAt ?? ''),
        )
    case 'most-played':
      return [...entries].sort((a, b) => b.meta.playCount - a.meta.playCount)
    case 'most-skipped':
      return [...entries].sort((a, b) => b.meta.skipCount - a.meta.skipCount)
    default:
      return entries
  }
}

function applyGroupKey(
  entries: LibraryEntry[],
  section: LibrarySectionId,
  groupKey: string | null,
): LibraryEntry[] {
  if (!groupKey) {
    return entries
  }

  switch (section) {
    case 'artists':
      return entries.filter((entry) => entry.track.artist === groupKey)
    case 'albums':
      return entries.filter(
        (entry) => (entry.track.album ?? UNKNOWN_ALBUM) === groupKey,
      )
    case 'folders':
      return entries.filter((entry) => (entry.meta.folderPath ?? '/') === groupKey)
    case 'categories':
      return entries.filter((entry) => entry.meta.categoryIds.includes(groupKey))
    case 'sources':
      return entries.filter((entry) => entry.track.sourceId === groupKey)
    default:
      return entries
  }
}

export function queryLibraryEntries(
  catalog: LibraryEntry[],
  state: LibraryQueryState,
  categories: Category[],
): LibraryEntry[] {
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  )

  let result = applyFilters(catalog, state.filters, categoryNames)
  result = applySectionPreset(result, state.section)
  result = applyGroupKey(result, state.section, state.filters.groupKey)

  const sectionForcesSort =
    state.section === 'recently-added' ||
    state.section === 'recently-played' ||
    state.section === 'most-played' ||
    state.section === 'most-skipped'

  if (!sectionForcesSort) {
    result = [...result].sort((a, b) =>
      compareEntries(a, b, state.sortField, state.sortDirection),
    )
  }

  return result
}

export function buildLibraryGroups(
  catalog: LibraryEntry[],
  section: LibrarySectionId,
  categories: Category[],
  filters: LibraryFilters,
): LibraryGroup[] {
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  )
  const filtered = applyFilters(
    catalog,
    { ...filters, groupKey: null },
    categoryNames,
  )

  const counts = new Map<string, { label: string; count: number }>()

  const bump = (key: string, label: string) => {
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    counts.set(key, { label, count: 1 })
  }

  switch (section) {
    case 'artists':
      for (const entry of filtered) {
        const artist = entry.track.artist || UNKNOWN_ARTIST
        bump(artist, artist)
      }
      break
    case 'albums':
      for (const entry of filtered) {
        const album = entry.track.album ?? UNKNOWN_ALBUM
        bump(album, album)
      }
      break
    case 'folders':
      for (const entry of filtered) {
        if (entry.meta.folderPath == null) {
          continue
        }
        const folder = entry.meta.folderPath
        bump(folder, folder === '/' ? 'Корень' : folder)
      }
      break
    case 'categories':
      for (const entry of filtered) {
        for (const categoryId of entry.meta.categoryIds) {
          bump(categoryId, categoryNames.get(categoryId) ?? categoryId)
        }
      }
      break
    case 'sources':
      for (const entry of filtered) {
        bump(entry.track.sourceId, getSourceDisplayName(entry.track.sourceId))
      }
      break
    default:
      return []
  }

  return [...counts.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

export function sectionHasLocalFolders(catalog: LibraryEntry[]): boolean {
  return catalog.some((entry) => entry.meta.folderPath != null)
}
