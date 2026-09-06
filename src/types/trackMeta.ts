import type { CollectionTrackData } from './collectionUser'
import type { Track } from './track'

/**
 * Пользовательские метаданные трека в библиотеке.
 * Источник истины — CollectionTrackData; UI не зависит от конкретного провайдера.
 */
export type TrackMeta = {
  trackId: string
  sourceId: string
  liked: boolean
  favorite: boolean
  playCount: number
  /** Ранее `skipped` в CollectionTrackData. */
  skipCount: number
  lastPlayedAt: string | null
  addedAt: string
  categoryIds: string[]
  /** Относительный путь папки для filesystem-источников. */
  folderPath: string | null
}

export type LibraryEntry = {
  track: Track
  meta: TrackMeta
}

export function trackMetaFromCollection(
  data: CollectionTrackData,
): TrackMeta {
  return {
    trackId: data.trackId,
    sourceId: data.sourceId,
    liked: data.liked,
    favorite: data.favorite,
    playCount: data.playCount,
    skipCount: data.skipped,
    lastPlayedAt: data.lastPlayed,
    addedAt: data.addedAt,
    categoryIds: [...data.categories],
    folderPath: extractFolderPath(data.track),
  }
}

export function defaultTrackMeta(track: Track): TrackMeta {
  return {
    trackId: track.id,
    sourceId: track.sourceId,
    liked: false,
    favorite: false,
    playCount: 0,
    skipCount: 0,
    lastPlayedAt: null,
    addedAt: new Date().toISOString(),
    categoryIds: [],
    folderPath: extractFolderPath(track),
  }
}

/** Для local-folder externalId = relative path файла. */
export function extractFolderPath(track: Track): string | null {
  if (track.sourceId !== 'local-folder') {
    return null
  }
  const path = track.externalId.replace(/\\/g, '/')
  const slash = path.lastIndexOf('/')
  if (slash <= 0) {
    return '/'
  }
  return path.slice(0, slash)
}
